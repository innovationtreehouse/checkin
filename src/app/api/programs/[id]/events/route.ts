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

        const currentProgram = await prisma.program.findUnique({ where: { id: programId } });
        if (!currentProgram) {
            return NextResponse.json({ error: "Program not found" }, { status: 404 });
        }

        const isLeadMentor = currentProgram.leadMentorId === (session.user as any).id;
        const isSysAdminOrBoard = (session.user as any)?.sysadmin || (session.user as any)?.boardMember;

        if (!isLeadMentor && !isSysAdminOrBoard) {
            return NextResponse.json({ error: "Forbidden: Only Admin, Board Members, or Lead Mentors can add events" }, { status: 403 });
        }

        const body = await req.json();
        const { name, start, end, description } = body;

        if (!name || !start || !end) {
            return NextResponse.json({ error: "Event name, start, and end are required" }, { status: 400 });
        }

        const newEvent = await prisma.event.create({
            data: {
                programId,
                name,
                start: new Date(start),
                end: new Date(end),
                description: description || null
            }
        });

        await prisma.auditLog.create({
            data: {
                actorId: (session.user as any).id,
                action: 'CREATE',
                tableName: 'Event',
                affectedEntityId: newEvent.id,
                newData: JSON.stringify(newEvent)
            }
        });

        return NextResponse.json({ success: true, event: newEvent });
    } catch (error) {
        console.error("Event creation error:", error);
        return NextResponse.json({ error: "Failed to create event" }, { status: 500 });
    }
}
