import prisma from "@/lib/prisma";
import { handler, badRequest, notFound, unauthorized } from "@/security/handler";

export const POST = handler<{ id: string }>('POST /api/programs/[id]/request-payment-plan', async ({ req, params, auth }) => {
    if (auth.type !== 'session') throw unauthorized();

    const programId = parseInt(params.id, 10);
    if (isNaN(programId)) {
        throw badRequest("Invalid program ID");
    }

    const body = await req.json();
    const { participantId } = body;

    if (!participantId) {
        throw badRequest("participantId is required");
    }

    const participant = await prisma.programParticipant.findUnique({
        where: {
            programId_participantId: {
                programId,
                participantId
            }
        },
        include: { participant: true, program: true }
    });

    if (!participant) {
        throw notFound("Participant not found in program");
    }

    const updatedParticipant = await prisma.programParticipant.update({
        where: {
            programId_participantId: { programId, participantId }
        },
        data: {
            paymentPlanRequested: true
        }
    });

    console.log(`[EMAIL DISPATCH] To: finances@innovationtreehouse.org, Subject: Payment Plan Request for ${participant.participant?.name || 'User'} in ${participant.program?.name || 'Program'}`);

    return { ProgramParticipant: updatedParticipant };
});
