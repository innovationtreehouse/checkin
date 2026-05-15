import prisma from "@/lib/prisma";
import { sendNotification } from "@/lib/notifications";
import { handler, badRequest, forbidden, notFound, unauthorized } from "@/security/handler";

export const POST = handler<{ id: string }>('POST /api/programs/[id]/participants', async ({ req, params, auth }) => {
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

    const currentProgram = await prisma.program.findUnique({
        where: { id: programId },
        include: {
            _count: { select: { participants: true } }
        }
    });
    if (!currentProgram) {
        throw notFound("Program not found");
    }

    const currentUserId = auth.user.id;
    const isSelfEnrollment = currentUserId === participantId;
    const isSysAdminOrBoard = auth.user.sysadmin || auth.user.boardMember;

    const participantData = await prisma.participant.findUnique({
        where: { id: participantId },
        select: { dob: true, householdId: true }
    });

    let isHouseholdLead = false;
    if (participantData?.householdId) {
        const leadRecord = await prisma.householdLead.findUnique({
            where: {
                householdId_participantId: {
                    householdId: participantData.householdId,
                    participantId: currentUserId
                }
            }
        });
        isHouseholdLead = !!leadRecord;
    }

    if (!isSelfEnrollment && !isSysAdminOrBoard && !isHouseholdLead) {
        throw forbidden("Forbidden: Not authorized to enroll this participant. Program leads cannot manually add participants.");
    }

    const override = body.override === true;

    // NOTE: The original endpoint returned 400 with { error, requiresOverride: true }
    // so the frontend could show an "Are you sure?" override toggle. The new
    // handler() error envelope only carries a status + message, so the
    // requiresOverride hint is no longer transmitted. Frontend users will see
    // the message but won't get a pre-populated override checkbox; they must
    // know to retry with override=true. Flagged for design review.
    if (!isSelfEnrollment && isSysAdminOrBoard && !override) {
        throw badRequest("This bypasses all payment. Re-submit with override=true to proceed.");
    }

    if (!override || (!isSysAdminOrBoard)) {
        if (currentProgram.maxParticipants !== null && currentProgram._count.participants >= currentProgram.maxParticipants) {
            throw badRequest("Program has reached maximum capacity.");
        }

        if (currentProgram.enrollmentStatus === 'CLOSED') {
            throw badRequest("Program enrollment is currently closed.");
        }

        if (currentProgram.minAge !== null || currentProgram.maxAge !== null) {
            if (!participantData?.dob) {
                throw badRequest("Participant Date of Birth is missing.");
            }
            const ageDifMs = Date.now() - new Date(participantData.dob).getTime();
            const ageDate = new Date(ageDifMs);
            const age = Math.abs(ageDate.getUTCFullYear() - 1970);
            if (currentProgram.minAge !== null && age < currentProgram.minAge) {
                throw badRequest(`Participant must be at least ${currentProgram.minAge} years old.`);
            }
            if (currentProgram.maxAge !== null && age > currentProgram.maxAge) {
                throw badRequest(`Participant maximum age is ${currentProgram.maxAge} years old.`);
            }
        }
    }

    const isFree = currentProgram.memberPrice === null && currentProgram.nonMemberPrice === null;

    const initialStatus = ((isSysAdminOrBoard && override) || isFree) ? 'ACTIVE' : 'PENDING';

    const enrollment = await prisma.programParticipant.create({
        data: {
            programId,
            participantId,
            status: initialStatus
        }
    });

    await prisma.auditLog.create({
        data: {
            actorId: currentUserId,
            action: 'CREATE',
            tableName: 'ProgramParticipant',
            affectedEntityId: participantId,
            secondaryAffectedEntity: programId,
            newData: JSON.stringify(enrollment)
        }
    });

    await sendNotification(participantId, 'PROGRAM_ENROLLMENT', { programName: currentProgram.name });

    return { ProgramParticipant: enrollment };
});

export const DELETE = handler<{ id: string }>('DELETE /api/programs/[id]/participants', async ({ req, params, auth }) => {
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

    const currentProgram = await prisma.program.findUnique({
        where: { id: programId }
    });

    if (!currentProgram) {
        throw notFound("Program not found");
    }

    const currentUserId = auth.user.id;
    const isSelfRemoval = currentUserId === participantId;
    const isLeadMentor = currentProgram.leadMentorId === currentUserId;
    const isSysAdminOrBoard = auth.user.sysadmin || auth.user.boardMember;

    if (!isSelfRemoval && !isLeadMentor && !isSysAdminOrBoard) {
        throw forbidden("Forbidden: Not authorized to remove this participant");
    }

    const enrollment = await prisma.programParticipant.delete({
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
            tableName: 'ProgramParticipant',
            affectedEntityId: participantId,
            secondaryAffectedEntity: programId,
            oldData: JSON.stringify(enrollment)
        }
    });

    return { ProgramParticipant: enrollment };
});
