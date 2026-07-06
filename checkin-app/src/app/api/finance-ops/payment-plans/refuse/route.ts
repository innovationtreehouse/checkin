import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { adjustProgramInventory } from "@/lib/shopify";
import { hasHouseholdConflict } from "@/lib/conflictOfInterest";

// Denies a pending scholarship / payment-plan request — the sibling of
// POST /api/finance-ops/payment-plans (approve) this branch previously lacked.
// The participant stays PENDING (they can still pay normally, or re-request);
// only the isPaymentPlanRequested flag clears. Same auth/conflict-of-interest
// posture as approve.
export const POST = withAuth(
    { roles: ['isSysadmin', 'isBoardMember'] },
    async (req, auth) => {
        try {
            const body = await req.json();
            const programId = parseInt(body.programId, 10);
            const participantId = parseInt(body.participantId, 10);

            if (Number.isNaN(programId) || Number.isNaN(participantId)) {
                return apiError("programId and participantId are required", 400);
            }

            // Conflict of interest: mirrors approve — a board member may not refuse
            // their OWN household's request either. Sysadmin bypasses.
            if (auth.type === 'session') {
                const target = await prisma.person.findUnique({ where: { id: participantId }, select: { householdId: true } });
                if (await hasHouseholdConflict(prisma, auth.user.id, target?.householdId, { isSysadmin: auth.user.isSysadmin === true })) {
                    return apiError("You cannot refuse your own household's payment plan — a sysadmin must.", 403);
                }
            }

            const data = { isPaymentPlanRequested: false };

            // Scope to the pending request so refusing a non-pending/nonexistent
            // request is a no-op error, mirroring approve's guard. Transactional
            // true->false guard: a double-refuse (already false) 409s instead of
            // crediting +1 twice.
            const { count } = await prisma.programParticipant.updateMany({
                where: { programId, personId: participantId, isPaymentPlanRequested: true, status: 'PENDING' },
                data,
            });

            if (count === 0) {
                return apiError("No pending payment-plan request", 409);
            }

            if (auth.type === 'session') {
                await prisma.auditLog.create({
                    data: {
                        actorId: auth.user.id,
                        action: "EDIT",
                        tableName: "ProgramParticipant",
                        affectedEntityId: participantId,
                        secondaryAffectedEntity: programId,
                        newData: data,
                    },
                });
            }

            // Scholarship lifecycle drives inventory (product decision 2026-07-06):
            // a refusal returns the seat to Shopify's pool, since the application
            // took it out of the pool. Non-fatal: the refusal itself already
            // committed above regardless of the Shopify result. The participant
            // row still exists PENDING (may re-apply, pay normally, or withdraw —
            // see the open policy question in this feature's PR body about a
            // refused-but-never-withdrawn participant still holding DB capacity).
            let warning: string | undefined;
            const program = await prisma.program.findUnique({ where: { id: programId } });
            if (program) {
                const ok = await adjustProgramInventory(program, 1);
                if (!ok) {
                    warning = "Payment plan refused, but the Shopify inventory adjustment failed. Capacity may be out of sync — check System Status > Link Status.";
                }
            }

            const responseObj: Record<string, unknown> = { success: true };
            if (warning) responseObj.warning = warning;
            return NextResponse.json(responseObj);
        } catch (error) {
            logger.error("Failed to refuse payment plan:", error);
            return apiError("Failed to refuse payment plan", 500);
        }
    }
);
