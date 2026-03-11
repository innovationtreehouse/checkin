/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../auth/[...nextauth]/route";
import prisma from "@/lib/prisma";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const session = await getServerSession(authOptions);

    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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

        const currentUserId = (session.user as any).id;
        const isSysAdminOrBoard = (session.user as any)?.sysadmin || (session.user as any)?.boardMember;
        const isLeadMentor = currentProgram.leadMentorId === currentUserId;

        if (!isSysAdminOrBoard && !isLeadMentor) {
            return NextResponse.json({ error: "Forbidden: Not authorized to update program settings" }, { status: 403 });
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

        // Build data object for Prisma
        const updateData: any = {};
        if (name !== undefined) updateData.name = name;
        if (begin !== undefined) updateData.begin = begin ? new Date(begin) : null;
        if (end !== undefined) updateData.end = end ? new Date(end) : null;
        if (phase !== undefined) updateData.phase = phase;
        if (enrollmentStatus !== undefined) updateData.enrollmentStatus = enrollmentStatus;
        if (memberOnly !== undefined) updateData.memberOnly = memberOnly;
        if (minAge !== undefined) updateData.minAge = minAge;
        if (maxParticipants !== undefined) updateData.maxParticipants = maxParticipants;
        if (leadMentorNotificationSettings !== undefined) updateData.leadMentorNotificationSettings = leadMentorNotificationSettings === null ? null : (leadMentorNotificationSettings as any);

        // leadMentorId can only be changed by SysAdmin or Board
        if (leadMentorId !== undefined) {
            if (isSysAdminOrBoard) {
                updateData.leadMentorId = leadMentorId;
            } else if (leadMentorId !== currentProgram.leadMentorId) {
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
}
