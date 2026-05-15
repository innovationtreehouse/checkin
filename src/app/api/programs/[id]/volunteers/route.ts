import prisma from "@/lib/prisma";
import { handler, badRequest, forbidden, notFound, unauthorized } from "@/security/handler";

export const POST = handler<{ id: string }>('POST /api/programs/[id]/volunteers', async ({ req, params, auth }) => {
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

    const currentProgram = await prisma.program.findUnique({ where: { id: programId } });
    if (!currentProgram) {
        throw notFound("Program not found");
    }

    const currentUserId = auth.user.id;
    const isLeadMentor = currentProgram.leadMentorId === currentUserId;
    const isSysAdminOrBoard = auth.user.sysadmin || auth.user.boardMember;

    if (!isLeadMentor && !isSysAdminOrBoard) {
        throw forbidden("Forbidden: Not authorized to assign volunteers");
    }

    const assignment = await prisma.programVolunteer.create({
        data: {
            programId,
            participantId,
            isCore: false
        }
    });

    await prisma.auditLog.create({
        data: {
            actorId: currentUserId,
            action: 'CREATE',
            tableName: 'ProgramVolunteer',
            affectedEntityId: participantId,
            secondaryAffectedEntity: programId,
            newData: JSON.stringify(assignment)
        }
    });

    return { ProgramVolunteer: assignment };
});

export const DELETE = handler<{ id: string }>('DELETE /api/programs/[id]/volunteers', async ({ req, params, auth }) => {
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

    const currentProgram = await prisma.program.findUnique({ where: { id: programId } });
    if (!currentProgram) {
        throw notFound("Program not found");
    }

    const currentUserId = auth.user.id;
    const isLeadMentor = currentProgram.leadMentorId === currentUserId;
    const isSysAdminOrBoard = auth.user.sysadmin || auth.user.boardMember;

    if (!isLeadMentor && !isSysAdminOrBoard) {
        throw forbidden("Forbidden: Not authorized to remove volunteers");
    }

    const assignment = await prisma.programVolunteer.delete({
        where: {
            programId_participantId: {
                programId,
                participantId
            }
        }
    });

    await prisma.auditLog.create({
        data: {
            actorId: currentUserId,
            action: 'DELETE',
            tableName: 'ProgramVolunteer',
            affectedEntityId: participantId,
            secondaryAffectedEntity: programId,
            oldData: JSON.stringify(assignment)
        }
    });

    return { ProgramVolunteer: assignment };
});

export const PATCH = handler<{ id: string }>('PATCH /api/programs/[id]/volunteers', async ({ req, params, auth }) => {
    if (auth.type !== 'session') throw unauthorized();

    const programId = parseInt(params.id, 10);
    if (isNaN(programId)) {
        throw badRequest("Invalid program ID");
    }

    const body = await req.json();
    const { participantId, isCore } = body;

    if (!participantId || isCore === undefined) {
        throw badRequest("participantId and isCore are required");
    }

    const currentProgram = await prisma.program.findUnique({ where: { id: programId } });
    if (!currentProgram) {
        throw notFound("Program not found");
    }

    const currentUserId = auth.user.id;
    const isLeadMentor = currentProgram.leadMentorId === currentUserId;
    const isSysAdminOrBoard = auth.user.sysadmin || auth.user.boardMember;

    if (!isLeadMentor && !isSysAdminOrBoard) {
        throw forbidden("Forbidden: Not authorized to modify volunteers");
    }

    const assignment = await prisma.programVolunteer.update({
        where: {
            programId_participantId: {
                programId,
                participantId
            }
        },
        data: {
            isCore
        }
    });

    await prisma.auditLog.create({
        data: {
            actorId: currentUserId,
            action: 'EDIT',
            tableName: 'ProgramVolunteer',
            affectedEntityId: participantId,
            secondaryAffectedEntity: programId,
            newData: JSON.stringify(assignment)
        }
    });

    return { ProgramVolunteer: assignment };
});
