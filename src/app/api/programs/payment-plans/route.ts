import prisma from "@/lib/prisma";
import { handler } from "@/security/handler";

export const GET = handler('GET /api/programs/payment-plans', async () => {
    const requests = await prisma.programParticipant.findMany({
        where: {
            paymentPlanRequested: true,
            status: 'PENDING'
        },
        include: {
            participant: true,
            program: true
        },
        orderBy: {
            pendingSince: 'asc'
        }
    });

    return { ProgramParticipant: requests };
});

export const POST = handler('POST /api/programs/payment-plans', async ({ req }) => {
    const body = await req.json();
    const { programId, participantId } = body;

    const updated = await prisma.programParticipant.update({
        where: {
            programId_participantId: {
                programId: parseInt(programId, 10),
                participantId: parseInt(participantId, 10)
            }
        },
        data: {
            status: 'ACTIVE',
            paymentPlanRequested: false,
            pendingSince: null
        }
    });

    return { ProgramParticipant: updated };
});
