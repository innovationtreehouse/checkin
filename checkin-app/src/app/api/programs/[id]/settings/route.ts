import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { apiError } from "@/lib/api-response";
import { LIVE_PERSON } from "@/lib/person/filters";
import { validateProgramAgeBounds } from "@/lib/programAge";
import { maybeAnnounceOnOpen } from "@/lib/programAnnounce";
import { ProgramPhase, EnrollmentStatus } from "@/generated/prisma/client";

export const PATCH = withAuth({}, async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
    if (auth.type !== 'session') return apiError("Unauthorized", 401);
    const { id } = await params;

    try {
        const programId = parseInt(id, 10);
        if (isNaN(programId)) {
            return apiError("Invalid program ID", 400);
        }

        const currentProgram = await prisma.program.findUnique({
            where: { id: programId }
        });

        if (!currentProgram) {
            return apiError("Program not found", 404);
        }

        const currentUserId = auth.user.id;
        const isSysAdminOrBoard = auth.user.isSysadmin || auth.user.isBoardMember;
        const isLeadMentor = currentProgram.leadMentorId === currentUserId;

        if (!isSysAdminOrBoard && !isLeadMentor) {
            return apiError("Forbidden: Not authorized to update program settings", 403);
        }

        const body = await req.json();
        const {
            name,
            leadMentorId,
            startAt,
            endAt,
            phase,
            enrollmentStatus,
            orgMemberOnly,
            announceOnOpen,
            minAge,
            maxAge,
            maxParticipants,
            leadMentorNotificationSettings
        } = body;

        // Validate the three announce-relevant fields up front: bad values would
        // otherwise surface as Prisma validation errors → generic 500, and
        // announceOnOpen now gates an email blast (#1164 review, finding 5).
        if (announceOnOpen !== undefined && typeof announceOnOpen !== "boolean") {
            return apiError("announceOnOpen must be a boolean", 400);
        }
        if (phase !== undefined && !Object.values(ProgramPhase).includes(phase)) {
            return apiError("Invalid phase", 400);
        }
        if (enrollmentStatus !== undefined && !Object.values(EnrollmentStatus).includes(enrollmentStatus)) {
            return apiError("Invalid enrollmentStatus", 400);
        }

        // Age range sanity. Use effective values (body overrides current) so a
        // one-sided edit can't leave minAge > maxAge or exceed the 25+ ceiling.
        const effMinAge = minAge !== undefined ? minAge : currentProgram.minAge;
        const effMaxAge = maxAge !== undefined ? maxAge : currentProgram.maxAge;
        const ageErr = validateProgramAgeBounds(effMinAge, effMaxAge);
        if (ageErr) {
            return apiError(ageErr, 400);
        }

        // maxParticipants: null = uncapped (allowed). Otherwise must be a
        // positive int and not below current enrollment, else the capacity lock
        // perma-rejects everyone. Mirrors the all-rows count in capacity.ts.
        if (maxParticipants !== undefined && maxParticipants !== null) {
            if (typeof maxParticipants !== "number" || !Number.isInteger(maxParticipants) || maxParticipants <= 0) {
                return apiError("maxParticipants must be a positive integer", 400);
            }
            const enrolled = await prisma.programParticipant.count({ where: { programId, person: LIVE_PERSON } });
            if (maxParticipants < enrolled) {
                return apiError(`maxParticipants cannot be set below the current enrollment of ${enrolled}`, 400);
            }
        }

        // Build data object for Prisma
        const updateData: Record<string, NonNullable<unknown> | null | string | number | boolean | Date> = {};
        if (name !== undefined) updateData.name = name;
        if (startAt !== undefined) updateData.startAt = startAt ? new Date(startAt) : null;
        if (endAt !== undefined) updateData.endAt = endAt ? new Date(endAt) : null;
        if (phase !== undefined) updateData.phase = phase;
        if (enrollmentStatus !== undefined) updateData.enrollmentStatus = enrollmentStatus;
        if (orgMemberOnly !== undefined) updateData.orgMemberOnly = orgMemberOnly;
        if (announceOnOpen !== undefined) updateData.announceOnOpen = announceOnOpen;
        if (minAge !== undefined) updateData.minAge = minAge;
        if (maxAge !== undefined) updateData.maxAge = maxAge;
        if (maxParticipants !== undefined) updateData.maxParticipants = maxParticipants;
        if (leadMentorNotificationSettings !== undefined) updateData.leadMentorNotificationSettings = leadMentorNotificationSettings === null ? null : (leadMentorNotificationSettings as unknown as never);

        // leadMentorId can only be changed by SysAdmin or Board
        if (leadMentorId !== undefined) {
            if (!leadMentorId) {
                return apiError("Lead Mentor is required", 400);
            }
            if (isSysAdminOrBoard) {
                updateData.leadMentorId = parseInt(leadMentorId, 10);
            } else if (parseInt(leadMentorId, 10) !== currentProgram.leadMentorId) {
                return apiError("Forbidden: Only administrators can reassign lead mentors", 403);
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

        // Announce trigger — transition rule, once-per-lifetime claim, audit row,
        // and fire-without-await all live in the helper. Never throws (the F1
        // committed-write-cant-500 guarantee moved into the helper's own try/catch).
        await maybeAnnounceOnOpen({
            programId,
            before: currentProgram,
            after: updatedProgram,
            actorId: currentUserId,
        });

        return NextResponse.json({ success: true, program: updatedProgram });
    } catch (error) {
        logger.error("Program settings update error:", error);
        return apiError("Failed to update program settings", 500);
    }
});
