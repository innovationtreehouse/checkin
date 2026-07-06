import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { apiError } from "@/lib/api-response";
import { adjustProgramInventory } from "@/lib/shopify";

export const POST = withAuth({}, async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
    if (auth.type !== 'session') return apiError("Unauthorized", 401);
    const { id } = await params;

    try {
        const programId = parseInt(id, 10);
        if (isNaN(programId)) {
            return apiError("Invalid program ID", 400);
        }

        const body = await req.json();
        const { participantId } = body;

        if (!participantId) {
            return apiError("participantId is required", 400);
        }

        const participant = await prisma.programParticipant.findUnique({
            where: {
                programId_personId: {
                    programId,
                    personId: participantId
                }
            },
            include: { person: true, program: true }
        });

        if (!participant) {
            return apiError("Participant not found in program", 404);
        }

        // Authorization: only the participant themselves, a lead of their household,
        // or a isSysadmin/board member may request a payment plan for this enrollment.
        // Without this gate any authenticated user could flip isPaymentPlanRequested
        // on an arbitrary participant's enrollment (IDOR). Deliberately NOT the
        // program's lead mentor: scholarship requested/denied is board/finance-
        // confidential, and a program volunteer should neither initiate it nor
        // observe the hardship fields.
        const currentUserId = auth.user.id;
        const isSelf = currentUserId === participantId;
        const isSysAdminOrBoard = auth.user.isSysadmin || auth.user.isBoardMember;

        let isHouseholdLead = false;
        if (!isSelf && !isSysAdminOrBoard && participant.person?.householdId) {
            const leadRecord = await prisma.person.findFirst({
                where: {
                    id: currentUserId,
                    householdId: participant.person.householdId,
                    isHouseholdLead: true
                },
                select: { id: true }
            });
            isHouseholdLead = !!leadRecord;
        }

        if (!isSelf && !isSysAdminOrBoard && !isHouseholdLead) {
            return apiError("Forbidden: Not authorized to request a payment plan for this participant", 403);
        }

        if (participant.status !== 'PENDING') {
            return apiError("This enrollment is not awaiting payment", 409);
        }

        // Hold-ledger (product decision 2026-07-06): APPLICATION takes a seat out
        // of Shopify's pool (-1), stamping inventoryHeldAt so every later release
        // path (withdrawal / payment / grace-expiry) or approval knows there's a
        // hold to account for. Guard is on inventoryHeldAt, NOT isPaymentPlanRequested:
        // a denied re-applicant still holds the seat (refuse no longer releases
        // it — see the refuse route), so re-applying must NOT decrement twice.
        // Branch 1 (inventoryHeldAt null -> now): the seat is genuinely free —
        // fires -1. Branch 2 (inventoryHeldAt already set): re-application while
        // holding (or an idempotent re-POST) — just (re)flips the request flag
        // and clears any denial stamp, no second decrement.
        const holdResult = await prisma.programParticipant.updateMany({
            where: { programId, personId: participantId, inventoryHeldAt: null },
            data: { isPaymentPlanRequested: true, inventoryHeldAt: new Date(), paymentPlanDeniedAt: null },
        });
        if (holdResult.count === 0) {
            await prisma.programParticipant.updateMany({
                where: { programId, personId: participantId, inventoryHeldAt: { not: null } },
                data: { isPaymentPlanRequested: true, paymentPlanDeniedAt: null },
            });
        }

        // Send email to finances
        // In a real implementation this would trigger an actual email via SendGrid, NodeMailer, etc.
        logger.info(`[EMAIL DISPATCH] To: finance@innovationtreehouse.org, Subject: Scholarship / Payment Plan Request for ${participant.person?.name || 'User'} in ${participant.program?.name || 'Program'}`);

        let warning: string | undefined;
        if (holdResult.count > 0 && participant.program) {
            const ok = await adjustProgramInventory(participant.program, -1);
            if (!ok) {
                // The seat was never taken out of Shopify — leaving inventoryHeldAt
                // set would be a phantom hold whose later release (+1) credits a
                // seat that was never removed (oversell). Roll the stamp back so
                // the ledger stays true; a re-submit retries the -1 via the
                // inventoryHeldAt:null branch above. (adjustProgramInventory has
                // already emailed sysadmins/board via reportShopifyFailure.)
                await prisma.programParticipant.updateMany({
                    where: { programId, personId: participantId, inventoryHeldAt: { not: null } },
                    data: { inventoryHeldAt: null },
                });
                warning = "Payment plan requested and finance notified, but the Shopify seat hold failed and was rolled back. Re-submit to retry, or check System Status > Link Status.";
            }
        }

        // Deliberately no raw ProgramParticipant echo: non-board callers (self /
        // household lead) must not read the hardship fields (paymentPlanDeniedAt,
        // inventoryHeldAt) off this response.
        const responseObj: Record<string, unknown> = { success: true };
        if (warning) responseObj.warning = warning;
        return NextResponse.json(responseObj);
    } catch (error) {
        logger.error("Payment plan request error:", error);
        return apiError("Failed to request payment plan", 500);
    }
});
