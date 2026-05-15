import prisma from "@/lib/prisma";
import { handler, badRequest, forbidden, notFound, unauthorized } from "@/security/handler";

export const POST = handler<{ id: string }>('POST /api/events/[id]/attendance', async ({ req, params, auth }) => {
    if (auth.type !== 'session') throw unauthorized();

    const eventId = parseInt(params.id, 10);
    if (isNaN(eventId)) {
        throw badRequest("Invalid event ID");
    }

    const event = await prisma.event.findUnique({
        where: { id: eventId },
        include: { program: true }
    });

    if (!event) {
        throw notFound("Event not found");
    }

    const user = auth.user;
    const currentUserId = user.id;
    const isLeadMentor = event.program?.leadMentorId === currentUserId;
    const isSysAdminOrBoardOrKeyholder = user.sysadmin || user.boardMember || user.keyholder;

    if (!isLeadMentor && !isSysAdminOrBoardOrKeyholder) {
        throw forbidden("Forbidden: Not authorized to validate attendance");
    }

    const body = await req.json();
    const { participantIds } = body;

    if (!Array.isArray(participantIds)) {
        throw badRequest("participantIds array is required");
    }

    const results = await prisma.$transaction(async (tx) => {
        const actions = [];

        const overlappingVisits = await tx.visit.findMany({
            where: {
                participantId: { in: participantIds },
                associatedEventId: null,
                arrived: { lte: event.end },
                OR: [
                    { departed: null },
                    { departed: { gte: event.start } }
                ]
            }
        });

        const visitsByParticipant = new Map();
        for (const visit of overlappingVisits) {
            if (!visitsByParticipant.has(visit.participantId)) {
                visitsByParticipant.set(visit.participantId, visit);
            }
        }

        for (const pId of participantIds) {
            const visit = visitsByParticipant.get(pId);

            if (visit) {
                const updated = await tx.visit.update({
                    where: { id: visit.id },
                    data: { associatedEventId: eventId }
                });
                actions.push(updated);
            } else {
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

    return { processed: results.length };
});
