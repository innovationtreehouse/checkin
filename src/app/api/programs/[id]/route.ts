import prisma from "@/lib/prisma";
import { handler, notFound, forbidden, badRequest, unauthorized } from "@/security/handler";

export const GET = handler<{ id: string }>('GET /api/programs/[id]', async ({ auth, params }) => {
    const programId = parseInt(params.id, 10);
    if (isNaN(programId)) throw badRequest('Invalid program ID');

    const program = await prisma.program.findUnique({
        where: { id: programId },
        include: {
            volunteers: { include: { participant: true } },
            participants: { include: { participant: { include: { household: true } } } },
            events: { orderBy: { start: 'asc' } },
            fees: true,
            leadMentor: true,
        },
    });

    if (!program) throw notFound('Program not found');

    const isSessionUser = auth.type === 'session';
    const sessionUser = isSessionUser ? auth.user : undefined;
    const isSysAdminOrBoard = !!(sessionUser?.sysadmin || sessionUser?.boardMember);
    const isLeadMentor = !!sessionUser && sessionUser.id === program.leadMentorId;
    const isCoreVolunteer = !!sessionUser && program.volunteers.some(v => v.participantId === sessionUser.id && v.isCore);
    const isPrivileged = isSysAdminOrBoard || isLeadMentor || isCoreVolunteer;

    if (program.memberOnly && !isPrivileged) {
        if (!sessionUser) throw notFound('Program not found');
        const participant = await prisma.participant.findUnique({
            where: { id: sessionUser.id },
            include: { memberships: { where: { active: true } } },
        });
        const hasActiveMembership = !!(participant && participant.memberships.length > 0);
        if (!hasActiveMembership) throw forbidden('Forbidden: Member-Only Program');
    }

    return { Program: program };
});

export const PATCH = handler<{ id: string }>('PATCH /api/programs/[id]', async ({ req, params, auth }) => {
    if (auth.type !== 'session') throw unauthorized();

    const programId = parseInt(params.id, 10);
    if (isNaN(programId)) {
        throw badRequest("Invalid program ID");
    }

    const currentProgram = await prisma.program.findUnique({ where: { id: programId } });
    if (!currentProgram) {
        throw notFound("Program not found");
    }

    const user = auth.user;
    const isLeadMentor = currentProgram.leadMentorId === user.id;
    const isSysAdminOrBoard = user.sysadmin || user.boardMember;

    if (!isLeadMentor && !isSysAdminOrBoard) {
        throw forbidden("Forbidden: Only Admin, Board Members, or Lead Mentors can edit");
    }

    const body = await req.json();
    let { leadMentorId } = body;
    const { name, begin, end, memberOnly, phase, enrollmentStatus, minAge, maxAge, maxParticipants, leadMentorNotificationSettings } = body;

    if (Object.prototype.hasOwnProperty.call(body, 'leadMentorId')) {
        if (!leadMentorId) {
            throw badRequest("Lead Mentor is required");
        }
        leadMentorId = parseInt(leadMentorId);
    }

    const updateData: Record<string, unknown> = {
        ...(name !== undefined && { name }),
        ...(leadMentorId !== undefined && { leadMentorId }),
        ...(begin !== undefined && { begin: begin ? new Date(begin) : null }),
        ...(end !== undefined && { end: end ? new Date(end) : null }),
        ...(memberOnly !== undefined && { memberOnly }),
        ...(phase !== undefined && { phase }),
        ...(enrollmentStatus !== undefined && { enrollmentStatus }),
        ...(minAge !== undefined && { minAge }),
        ...(maxAge !== undefined && { maxAge }),
        ...(maxParticipants !== undefined && { maxParticipants }),
        ...(leadMentorNotificationSettings !== undefined && { leadMentorNotificationSettings }),
    };

    const updatedProgram = await prisma.program.update({
        where: { id: programId },
        data: updateData
    });

    await prisma.auditLog.create({
        data: {
            actorId: user.id,
            action: 'EDIT',
            tableName: 'Program',
            affectedEntityId: updatedProgram.id,
            oldData: JSON.stringify(currentProgram),
            newData: JSON.stringify(updatedProgram)
        }
    });

    return { Program: updatedProgram };
});
