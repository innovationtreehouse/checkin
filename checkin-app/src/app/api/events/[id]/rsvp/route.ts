import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth-options";
import prisma from "@/lib/prisma";
import { canActFor } from "@/lib/household/activityMembers";

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

        // Target defaults to self; a household lead may RSVP for a member of
        // their household. Authorize the target before trusting it.
        const targetId = typeof body.participantId === "number" ? body.participantId : session.user.id;
        if (!(await canActFor(session, targetId))) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        const currentUserId = targetId;

        // Verify the event exists and the user is enrolled in the program (if applicable)
        const event = await prisma.event.findUnique({
            where: { id: eventId },
            include: { program: true }
        });

        if (!event) {
            return NextResponse.json({ error: "Event not found" }, { status: 404 });
        }

        // Can't RSVP to an event that already finished. Use end (not start) so an
        // in-progress event still accepts RSVPs.
        if (event.end.getTime() < Date.now()) {
            return NextResponse.json({ error: "Cannot RSVP to a past event" }, { status: 400 });
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
                status: status as 'ATTENDING' | 'NOT_ATTENDING' | 'NO_RESPONSE' | 'MAYBE'
            },
            create: {
                eventId,
                participantId: currentUserId,
                status: status as 'ATTENDING' | 'NOT_ATTENDING' | 'NO_RESPONSE' | 'MAYBE'
            }
        });

        return NextResponse.json({ success: true, rsvp });
    } catch (error) {
        console.error("RSVP update error:", error);
        return NextResponse.json({ error: "Failed to update RSVP" }, { status: 500 });
    }
}
