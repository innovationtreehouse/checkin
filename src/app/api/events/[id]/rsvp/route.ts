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
        const eventId = parseInt(id, 10);
        if (isNaN(eventId)) {
            return NextResponse.json({ error: "Invalid event ID" }, { status: 400 });
        }

        const body = await req.json();
        const { status } = body;

        const validStatuses = ["ATTENDING", "NOT_ATTENDING", "NO_RESPONSE", "MAYBE"];
        if (!status || !validStatuses.includes(status)) {
            return NextResponse.json({ error: "Invalid RSVP status" }, { status: 400 });
        }

        const currentUserId = parseInt((session.user as any).id, 10);

        // Verify the event exists and the user is enrolled in the program (if applicable)
        const event = await prisma.event.findUnique({
            where: { id: eventId },
            include: { program: true }
        });

        if (!event) {
            return NextResponse.json({ error: "Event not found" }, { status: 404 });
        }

        if (event.programId) {
            const isEnrolled = await prisma.programParticipant.findUnique({
                where: {
                    programId_participantId: {
                        programId: event.programId,
                        participantId: currentUserId
                    }
                }
            });
            const isVolunteer = await prisma.programVolunteer.findUnique({
                where: {
                    programId_participantId: {
                        programId: event.programId,
                        participantId: currentUserId
                    }
                }
            });

            if (!isEnrolled && !isVolunteer) {
                return NextResponse.json({ error: "Forbidden: You are not a participant of this program" }, { status: 403 });
            }
        }

        const rsvp = await prisma.rSVP.upsert({
            where: {
                eventId_participantId: {
                    eventId,
                    participantId: currentUserId
                }
            },
            update: {
                status: status as any
            },
            create: {
                eventId,
                participantId: currentUserId,
                status: status as any
            }
        });

        return NextResponse.json({ success: true, rsvp });
    } catch (error) {
        console.error("RSVP update error:", error);
        return NextResponse.json({ error: "Failed to update RSVP" }, { status: 500 });
    }
}
