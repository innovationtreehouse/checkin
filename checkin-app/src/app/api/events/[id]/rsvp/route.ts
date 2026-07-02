import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import type { Session } from "next-auth";
import { withAuth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { canActFor } from "@/lib/household/activityMembers";
import { RSVP_STATUSES, type RSVPStatus } from "@/types/rsvp";

export const PATCH = withAuth({}, async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
    if (auth.type !== 'session') return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    // canActFor only reads session.user; reconstruct the minimal shape from auth.user.
    const session = { user: auth.user } as unknown as Session;

    try {
        const eventId = parseInt(id, 10);
        if (isNaN(eventId)) {
            return NextResponse.json({ error: "Invalid event ID" }, { status: 400 });
        }

        const body = await req.json();
        const { status } = body;

        if (!status || !RSVP_STATUSES.includes(status)) {
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

        // Can't RSVP to an event that already finished. Use endAt (not startAt) so an
        // in-progress event still accepts RSVPs.
        if (event.endAt.getTime() < Date.now()) {
            return NextResponse.json({ error: "Cannot RSVP to a past event" }, { status: 400 });
        }

        if (event.programId) {
            const isEnrolled = await prisma.programParticipant.findUnique({
                where: {
                    programId_personId: {
                        programId: event.programId,
                        personId: currentUserId
                    }
                }
            });
            const isVolunteer = await prisma.programVolunteer.findUnique({
                where: {
                    programId_personId: {
                        programId: event.programId,
                        personId: currentUserId
                    }
                }
            });

            if (!isEnrolled && !isVolunteer) {
                return NextResponse.json({ error: "Forbidden: You are not a participant of this program" }, { status: 403 });
            }
        }

        const rsvp = await prisma.rSVP.upsert({
            where: {
                eventId_personId: {
                    eventId,
                    personId: currentUserId
                }
            },
            update: {
                status: status as RSVPStatus
            },
            create: {
                eventId,
                personId: currentUserId,
                status: status as RSVPStatus
            }
        });

        return NextResponse.json({ success: true, rsvp });
    } catch (error) {
        logger.error("RSVP update error:", error);
        return NextResponse.json({ error: "Failed to update RSVP" }, { status: 500 });
    }
});
