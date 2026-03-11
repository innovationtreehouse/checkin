/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../auth/[...nextauth]/route";
import prisma from "@/lib/prisma";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
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

        const body = await req.json();
        const { publish } = body;

        if (publish !== true) {
            return NextResponse.json({ error: "publish must be true" }, { status: 400 });
        }

        const currentProgram = await prisma.program.findUnique({
            where: { id: programId },
            include: { events: true }
        });

        if (!currentProgram) {
            return NextResponse.json({ error: "Program not found" }, { status: 404 });
        }

        const currentUserId = (session.user as any).id;
        const isSysAdminOrBoard = (session.user as any)?.sysadmin || (session.user as any)?.boardMember;
        const isLeadMentor = currentProgram.leadMentorId === currentUserId;

        if (!isSysAdminOrBoard && !isLeadMentor) {
            return NextResponse.json({ error: "Forbidden: Not authorized to publish this program" }, { status: 403 });
        }

        if (publish) {
            // Validation rules for publishing
            if (!currentProgram.leadMentorId) {
                return NextResponse.json({ error: "Cannot publish a program without a Lead Mentor assigned" }, { status: 400 });
            }
            if (currentProgram.events.length === 0) {
                return NextResponse.json({ error: "Cannot publish a program without any scheduled events" }, { status: 400 });
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
                newData: { phase: 'UPCOMING', enrollmentStatus: 'OPEN' } as any
            }
        });

        return NextResponse.json({ success: true, program: updatedProgram });
    } catch (error) {
        console.error("Program publish error:", error);
        return NextResponse.json({ error: "Failed to set publish state" }, { status: 500 });
    }
}
