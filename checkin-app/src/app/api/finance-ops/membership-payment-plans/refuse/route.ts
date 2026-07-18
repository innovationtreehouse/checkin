import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { fromWhere } from "@/lib/membership/lifecycle";
import { resolveScholarshipRecipients, sendScholarshipStatus } from "@/lib/scholarshipEmails";

// Denies a pending membership scholarship / payment-plan request — the sibling
// of POST /api/finance-ops/membership-payment-plans (approve) that membership
// previously lacked, so a declined request sat PENDING_PAYMENT forever with no
// follow-up email (the request ack promises one). Closes the program/membership
// deny asymmetry (docs/PROGRAM_CAPACITY_AND_SCHOLARSHIPS.md §5 item 4).
//
// Unlike the program deny, membership has NO held Shopify seat (dues are paid to
// activate, no seat is reserved on request) and NO grace-expiry cron, so denial
// is purely clearing isPaymentPlanRequested back to false: the process stays
// PENDING_PAYMENT and the household returns to normal "pay your dues to activate".
// There is no paymentPlanDeniedAt column on OrgMembershipProcess and none is
// needed — the cleared flag is the whole of denial state.
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

            // Only act on a genuinely-requested, still-awaiting-payment process, so
            // denying a stale/nonexistent request is a no-op error, mirroring the
            // approve route's probe. Transactional true->false guard: a double-deny
            // (already false) 409s and sends no email.
            const data = { isPaymentPlanRequested: false };
            const { count } = await prisma.orgMembershipProcess.updateMany({
                // Deny CAS: from-state status from the definition (#1080); isPaymentPlanRequested stays literal.
                where: { id: processId, isPaymentPlanRequested: true, ...fromWhere('PENDING_PAYMENT') },
                data,
            });

            if (count === 0) {
                return apiError("No pending payment-plan request", 409);
            }

            await prisma.auditLog.create({
                data: {
                    actorId: auth.user.id,
                    action: "EDIT",
                    tableName: "OrgMembershipProcess",
                    affectedEntityId: processId,
                    newData: { paymentPlanDenied: true, isPaymentPlanRequested: false },
                },
            });

            // Fire-and-forget status email after the transition commits (a failed send
            // never fails the request). Mirrors program deny voice MINUS the seat/grace
            // lines — membership holds no seat and has no grace deadline.
            const process = await prisma.orgMembershipProcess.findUnique({
                where: { id: processId },
                select: { orgMembership: { select: { householdId: true } } },
            });
            const householdId = process?.orgMembership?.householdId;
            if (householdId) {
                const recipients = await resolveScholarshipRecipients(householdId); // no requester at deny time
                await sendScholarshipStatus(
                    recipients,
                    "Update on your membership scholarship / payment-plan request",
                    `<p>The Scholarship Review Team was unable to approve your household's scholarship / payment plan `
                    + `for your Treehouse membership dues at this time.</p>`
                    + `<p>You can still pay your dues normally to activate your membership.</p>`,
                );
            }

            return NextResponse.json({ success: true });
        } catch (error) {
            logger.error("Failed to refuse membership payment plan:", error);
            return apiError("Failed to refuse payment plan", 500);
        }
    }
);
