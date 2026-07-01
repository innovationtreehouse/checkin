import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const PATCH = withAuth({}, async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
    if (auth.type !== 'session') return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;

    try {
        const programId = parseInt(id, 10);
        if (isNaN(programId)) {
            return NextResponse.json({ error: "Invalid program ID" }, { status: 400 });
        }

        const currentProgram = await prisma.program.findUnique({
            where: { id: programId }
        });

        if (!currentProgram) {
            return NextResponse.json({ error: "Program not found" }, { status: 404 });
        }

        const currentUserId = auth.user.id;
        const isSysAdminOrBoard = auth.user.isSysadmin || auth.user.isBoardMember;
        const isLeadMentor = currentProgram.leadMentorId === currentUserId;

        if (!isSysAdminOrBoard && !isLeadMentor) {
            return NextResponse.json({ error: "Forbidden: Not authorized to update program settings" }, { status: 403 });
        }

        const body = await req.json();
        const {
            name,
            leadMentorId,
            startAt,
            endAt,
            phase,
            enrollmentStatus,
            memberOnly,
            minAge,
            maxAge,
            maxParticipants,
            leadMentorNotificationSettings
        } = body;

        // Age range sanity. Use effective values (body overrides current) so a
        // one-sided edit can't leave minAge > maxAge.
        const effMinAge = minAge !== undefined ? minAge : currentProgram.minAge;
        const effMaxAge = maxAge !== undefined ? maxAge : currentProgram.maxAge;
        if (minAge != null && minAge < 0) {
            return NextResponse.json({ error: "minAge cannot be negative" }, { status: 400 });
        }
        if (maxAge != null && maxAge < 0) {
            return NextResponse.json({ error: "maxAge cannot be negative" }, { status: 400 });
        }
        if (effMinAge != null && effMaxAge != null && effMinAge > effMaxAge) {
            return NextResponse.json({ error: "minAge cannot exceed maxAge" }, { status: 400 });
        }

        // maxParticipants: null = uncapped (allowed). Otherwise must be a
        // positive int and not below current enrollment, else the capacity lock
        // perma-rejects everyone. Mirrors the all-rows count in capacity.ts.
        if (maxParticipants !== undefined && maxParticipants !== null) {
            if (typeof maxParticipants !== "number" || !Number.isInteger(maxParticipants) || maxParticipants <= 0) {
                return NextResponse.json({ error: "maxParticipants must be a positive integer" }, { status: 400 });
            }
            const enrolled = await prisma.programParticipant.count({ where: { programId } });
            if (maxParticipants < enrolled) {
                return NextResponse.json({ error: `maxParticipants cannot be set below the current enrollment of ${enrolled}` }, { status: 400 });
            }
        }

        // Build data object for Prisma
        const updateData: Record<string, NonNullable<unknown> | null | string | number | boolean | Date> = {};
        if (name !== undefined) updateData.name = name;
        if (startAt !== undefined) updateData.startAt = startAt ? new Date(startAt) : null;
        if (endAt !== undefined) updateData.endAt = endAt ? new Date(endAt) : null;
        if (phase !== undefined) updateData.phase = phase;
        if (enrollmentStatus !== undefined) updateData.enrollmentStatus = enrollmentStatus;
        if (memberOnly !== undefined) updateData.memberOnly = memberOnly;
        if (minAge !== undefined) updateData.minAge = minAge;
        if (maxAge !== undefined) updateData.maxAge = maxAge;
        if (maxParticipants !== undefined) updateData.maxParticipants = maxParticipants;
        if (leadMentorNotificationSettings !== undefined) updateData.leadMentorNotificationSettings = leadMentorNotificationSettings === null ? null : (leadMentorNotificationSettings as unknown as never);

        // leadMentorId can only be changed by SysAdmin or Board
        if (leadMentorId !== undefined) {
            if (!leadMentorId) {
                return NextResponse.json({ error: "Lead Mentor is required" }, { status: 400 });
            }
            if (isSysAdminOrBoard) {
                updateData.leadMentorId = parseInt(leadMentorId, 10);
            } else if (parseInt(leadMentorId, 10) !== currentProgram.leadMentorId) {
                return NextResponse.json({ error: "Forbidden: Only administrators can reassign lead mentors" }, { status: 403 });
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

        return NextResponse.json({ success: true, program: updatedProgram });
    } catch (error) {
        console.error("Program settings update error:", error);
        return NextResponse.json({ error: "Failed to update program settings" }, { status: 500 });
    }
});
