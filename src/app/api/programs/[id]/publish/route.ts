import prisma from "@/lib/prisma";
import { handler, badRequest, forbidden, notFound, unauthorized } from "@/security/handler";

export const POST = handler<{ id: string }>('POST /api/programs/[id]/publish', async ({ req, params, auth }) => {
    if (auth.type !== 'session') throw unauthorized();

    const programId = parseInt(params.id, 10);
    if (isNaN(programId)) {
        throw badRequest("Invalid program ID");
    }

    const body = await req.json();
    const { publish } = body;

    if (publish !== true) {
        throw badRequest("publish must be true");
    }

    const currentProgram = await prisma.program.findUnique({
        where: { id: programId },
        include: { events: true }
    });

    if (!currentProgram) {
        throw notFound("Program not found");
    }

    const currentUserId = auth.user.id;
    const isSysAdminOrBoard = auth.user.sysadmin || auth.user.boardMember;
    const isLeadMentor = currentProgram.leadMentorId === currentUserId;

    if (!isSysAdminOrBoard && !isLeadMentor) {
        throw forbidden("Forbidden: Not authorized to publish this program");
    }

    if (publish) {
        if (!currentProgram.leadMentorId) {
            throw badRequest("Cannot publish a program without a Lead Mentor assigned");
        }
        if (currentProgram.events.length === 0) {
            throw badRequest("Cannot publish a program without any scheduled events");
        }
    }

    const updatedProgram = await prisma.program.update({
        where: { id: programId },
        data: { phase: 'UPCOMING', enrollmentStatus: 'OPEN' }
    });

    await prisma.auditLog.create({
        data: {
            actorId: currentUserId,
            action: 'EDIT',
            tableName: 'Program',
            affectedEntityId: programId,
            newData: { phase: 'UPCOMING', enrollmentStatus: 'OPEN' } as unknown as never
        }
    });

    return { Program: updatedProgram };
});
