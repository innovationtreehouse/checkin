import prisma from "@/lib/prisma";
import { handler, badRequest, forbidden, notFound, unauthorized } from "@/security/handler";

export const PATCH = handler<{ id: string }>('PATCH /api/programs/[id]/settings', async ({ req, params, auth }) => {
    if (auth.type !== 'session') throw unauthorized();

    const programId = parseInt(params.id, 10);
    if (isNaN(programId)) {
        throw badRequest("Invalid program ID");
    }

    const currentProgram = await prisma.program.findUnique({
        where: { id: programId }
    });

    if (!currentProgram) {
        throw notFound("Program not found");
    }

    const currentUserId = auth.user.id;
    const isSysAdminOrBoard = auth.user.sysadmin || auth.user.boardMember;
    const isLeadMentor = currentProgram.leadMentorId === currentUserId;

    if (!isSysAdminOrBoard && !isLeadMentor) {
        throw forbidden("Forbidden: Not authorized to update program settings");
    }

    const body = await req.json();
    const {
        name,
        leadMentorId,
        begin,
        end,
        phase,
        enrollmentStatus,
        memberOnly,
        minAge,
        maxParticipants,
        leadMentorNotificationSettings
    } = body;

    const updateData: Record<string, NonNullable<unknown> | null | string | number | boolean | Date> = {};
    if (name !== undefined) updateData.name = name;
    if (begin !== undefined) updateData.begin = begin ? new Date(begin) : null;
    if (end !== undefined) updateData.end = end ? new Date(end) : null;
    if (phase !== undefined) updateData.phase = phase;
    if (enrollmentStatus !== undefined) updateData.enrollmentStatus = enrollmentStatus;
    if (memberOnly !== undefined) updateData.memberOnly = memberOnly;
    if (minAge !== undefined) updateData.minAge = minAge;
    if (maxParticipants !== undefined) updateData.maxParticipants = maxParticipants;
    if (leadMentorNotificationSettings !== undefined) updateData.leadMentorNotificationSettings = leadMentorNotificationSettings === null ? null : (leadMentorNotificationSettings as unknown as never);

    if (leadMentorId !== undefined) {
        if (!leadMentorId) {
            throw badRequest("Lead Mentor is required");
        }
        if (isSysAdminOrBoard) {
            updateData.leadMentorId = parseInt(leadMentorId, 10);
        } else if (parseInt(leadMentorId, 10) !== currentProgram.leadMentorId) {
            throw forbidden("Forbidden: Only administrators can reassign lead mentors");
        }
    }

    const updatedProgram = await prisma.program.update({
        where: { id: programId },
        data: updateData
    });

    await prisma.auditLog.create({
        data: {
            actorId: currentUserId,
            action: 'EDIT',
            tableName: 'Program',
            affectedEntityId: programId,
            newData: updateData
        }
    });

    return { Program: updatedProgram };
});
