import prisma from "@/lib/prisma";
import { handler, badRequest, forbidden, notFound, unauthorized } from "@/security/handler";

export const PATCH = handler<{ id: string }>('PATCH /api/events/[id]/rsvp', async ({ req, params, auth }) => {
    if (auth.type !== 'session') throw unauthorized();

    const eventId = parseInt(params.id, 10);
    if (isNaN(eventId)) {
        throw badRequest("Invalid event ID");
    }

    const body = await req.json();
    const { status } = body;

    const validStatuses = ["ATTENDING", "NOT_ATTENDING", "NO_RESPONSE", "MAYBE"];
    if (!status || !validStatuses.includes(status)) {
        throw badRequest("Invalid RSVP status");
    }

    const currentUserId = auth.user.id;

    const event = await prisma.event.findUnique({
        where: { id: eventId },
        include: { program: true }
    });

    if (!event) {
        throw notFound("Event not found");
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
            throw forbidden("Forbidden: You are not a participant of this program");
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

    return { RSVP: rsvp };
});
