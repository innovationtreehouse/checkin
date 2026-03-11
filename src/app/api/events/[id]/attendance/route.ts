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
        const eventId = parseInt(id, 10);
        if (isNaN(eventId)) {
            return NextResponse.json({ error: "Invalid event ID" }, { status: 400 });
        }

        const event = await prisma.event.findUnique({
            where: { id: eventId },
            include: { program: true }
        });

        if (!event) {
            return NextResponse.json({ error: "Event not found" }, { status: 404 });
        }

        const currentUserId = (session.user as any).id;
        const isLeadMentor = event.program?.leadMentorId === currentUserId;
        const isSysAdminOrBoardOrKeyholder = (session.user as any)?.sysadmin || (session.user as any)?.boardMember || (session.user as any)?.keyholder;

        if (!isLeadMentor && !isSysAdminOrBoardOrKeyholder) {
            return NextResponse.json({ error: "Forbidden: Not authorized to validate attendance" }, { status: 403 });
        }

        const body = await req.json();
        const { participantIds } = body; // Array of participant IDs who actually attended

        if (!Array.isArray(participantIds)) {
            return NextResponse.json({ error: "participantIds array is required" }, { status: 400 });
        }

        const results = await prisma.$transaction(async (tx) => {
            const actions = [];
            for (const pId of participantIds) {
                // Find an existing unassociated visit overlapping with the event, or create one
                const visit = await tx.visit.findFirst({
                    where: {
                        participantId: pId,
                        associatedEventId: null,
                        arrived: { lte: event.end },
                        OR: [
                            { departed: null },
                            { departed: { gte: event.start } }
                        ]
                    }
                });

                if (visit) {
                    const updated = await tx.visit.update({
                        where: { id: visit.id },
                        data: { associatedEventId: eventId }
                    });
                    actions.push(updated);
                } else {
                    // Create a synthetic visit since they were marked attended but didn't badge in
                    const newVisit = await tx.visit.create({
                        data: {
                            participantId: pId,
                            associatedEventId: eventId,
                            arrived: event.start,
                            departed: event.end
                        }
                    });
                    actions.push(newVisit);
                }
            }
            return actions;
        });

        await prisma.auditLog.create({
            data: {
                actorId: currentUserId,
                action: 'EDIT',
                tableName: 'Visit',
                affectedEntityId: eventId,
                newData: JSON.stringify({ validatedParticipants: participantIds })
            }
        });

        return NextResponse.json({ success: true, processed: results.length });
    } catch (error) {
        console.error("Attendance validation error:", error);
        return NextResponse.json({ error: "Failed to validate attendance" }, { status: 500 });
    }
}
