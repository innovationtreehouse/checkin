import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { apiError } from "@/lib/api-response";

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
        // the program's lead mentor, or a isSysadmin/board member may request a payment
        // plan for this enrollment. Without this gate any authenticated user could flip
        // isPaymentPlanRequested on an arbitrary participant's enrollment (IDOR).
        const currentUserId = auth.user.id;
        const isSelf = currentUserId === participantId;
        const isSysAdminOrBoard = auth.user.isSysadmin || auth.user.isBoardMember;
        const isLeadMentor = participant.program?.leadMentorId === currentUserId;

        let isHouseholdLead = false;
        if (!isSelf && !isSysAdminOrBoard && !isLeadMentor && participant.person?.householdId) {
            const leadRecord = await prisma.householdLead.findUnique({
                where: {
                    householdId_personId: {
                        householdId: participant.person.householdId,
                        personId: currentUserId
                    }
                }
            });
            isHouseholdLead = !!leadRecord;
        }

        if (!isSelf && !isSysAdminOrBoard && !isLeadMentor && !isHouseholdLead) {
            return apiError("Forbidden: Not authorized to request a payment plan for this participant", 403);
        }

        const updatedParticipant = await prisma.programParticipant.update({
            where: {
                programId_personId: { programId, personId: participantId }
            },
            data: {
                isPaymentPlanRequested: true
            }
        });

        // Send email to finances
        // In a real implementation this would trigger an actual email via SendGrid, NodeMailer, etc.
        logger.info(`[EMAIL DISPATCH] To: finances@innovationtreehouse.org, Subject: Payment Plan Request for ${participant.person?.name || 'User'} in ${participant.program?.name || 'Program'}`);

        return NextResponse.json({ success: true, participant: updatedParticipant });
    } catch (error) {
        logger.error("Payment plan request error:", error);
        return apiError("Failed to request payment plan", 500);
    }
});
