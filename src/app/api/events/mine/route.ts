import prisma from "@/lib/prisma";
import { handler, unauthorized } from "@/security/handler";

export const GET = handler('GET /api/events/mine', async ({ auth }) => {
    if (auth.type !== 'session') throw unauthorized();
    const userId = auth.user.id;

    const enrolledPrograms = await prisma.programParticipant.findMany({
        where: { participantId: userId },
        select: { programId: true }
    });
    const volunteerPrograms = await prisma.programVolunteer.findMany({
        where: { participantId: userId },
        select: { programId: true }
    });

    const programIds = [
        ...enrolledPrograms.map(p => p.programId),
        ...volunteerPrograms.map(p => p.programId)
    ];

    const events = await prisma.event.findMany({
        where: {
            programId: { in: programIds },
            end: { gte: new Date() }
        },
        orderBy: { start: 'asc' },
        include: {
            program: { select: { name: true } },
            rsvps: {
                where: { participantId: userId }
            }
        }
    });

    return { Event: events };
});
