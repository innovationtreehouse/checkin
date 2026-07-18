import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { hasHouseholdConflict } from "@/lib/conflictOfInterest";
import { fromWhere } from "@/lib/membership/lifecycle";

// Denies a pending membership scholarship / payment-plan request — the sibling
// of POST /api/finance-ops/membership-payment-plans (approve) that membership
// previously lacked, so a declined request had no board action and sat
// PENDING_PAYMENT on the queue indefinitely. This gives the board a dedicated
// deny control (docs/PROGRAM_CAPACITY_AND_SCHOLARSHIPS.md §5 item 4).
//
// Silent by design, like every other board decision (approve on both sides,
// program deny): sends NO automatic applicant email — the Scholarship Review
// Team communicates the outcome manually. Denial is purely clearing
// isPaymentPlanRequested back to false: the process stays PENDING_PAYMENT and
// the household returns to normal "pay your dues to activate". Membership holds
// no Shopify seat and has no grace-expiry cron (grace is program-only), so there
// is no seat to release and no paymentPlanDeniedAt to stamp — OrgMembershipProcess
// has no such column and needs none; the cleared flag is the whole of denial state.
export const POST = withAuth(
    { roles: ['isBoardMember'] },
    async (req, auth) => {
        try {
            const body = await req.json();
            const processId = parseInt(body.processId, 10);

            if (Number.isNaN(processId)) {
                return apiError("processId is required", 400);
            }
            if (auth.type !== 'session') {
                return apiError("Unauthorized", 401);
            }

            // Conflict of interest: a board member may not deny their OWN household's
            // request. Sysadmin bypasses. Approve enforces this inside certifyPaymentPlan
            // (payment.ts) and program refuse checks it at route level — mirror that here.
            // A nonexistent process → null householdId → no conflict → falls through to the
            // CAS below, which 409s (not 403), keeping "not found" distinct from "your own".
            const target = await prisma.orgMembershipProcess.findUnique({
                where: { id: processId },
                select: { orgMembership: { select: { householdId: true } } },
            });
            if (await hasHouseholdConflict(prisma, auth.user.id, target?.orgMembership?.householdId, { isSysadmin: auth.user.isSysadmin === true })) {
                return apiError("You cannot deny your own household's payment plan — a sysadmin must.", 403);
            }

            const data = { isPaymentPlanRequested: false };

            // CAS + audit atomically (archive.ts pattern): a crash between the flag
            // flip and the audit write would otherwise leave a flag-flipped denial
            // with no audit row and no way to retry (the guard is already false).
            // Only act on a genuinely-requested, still-awaiting-payment process, so
            // denying a stale/nonexistent request is a no-op 409, mirroring approve's
            // probe. Transactional true->false guard: a double-deny (already false) 409s.
            const denied = await prisma.$transaction(async (tx) => {
                const { count } = await tx.orgMembershipProcess.updateMany({
                    // Deny CAS: from-state status from the definition (#1080); isPaymentPlanRequested stays literal.
                    where: { id: processId, isPaymentPlanRequested: true, ...fromWhere('PENDING_PAYMENT') },
                    data,
                });
                if (count === 0) return false;
                await tx.auditLog.create({
                    data: {
                        actorId: auth.user.id,
                        action: "EDIT",
                        tableName: "OrgMembershipProcess",
                        affectedEntityId: processId,
                        newData: { paymentPlanDenied: true, isPaymentPlanRequested: false },
                    },
                });
                return true;
            });

            if (!denied) {
                return apiError("No pending payment-plan request", 409);
            }

            return NextResponse.json({ success: true });
        } catch (error) {
            logger.error("Failed to refuse membership payment plan:", error);
            return apiError("Failed to refuse payment plan", 500);
        }
    }
);
