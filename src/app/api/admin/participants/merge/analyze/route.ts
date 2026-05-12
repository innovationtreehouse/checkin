import prisma from "@/lib/prisma";
import { handler, badRequest, notFound } from "@/security/handler";

export const dynamic = 'force-dynamic';

export const GET = handler('GET /api/admin/participants/merge/analyze', async ({ req }) => {
    const url = new URL(req.url);
    const aId = parseInt(url.searchParams.get('a') || '0');
    const bId = parseInt(url.searchParams.get('b') || '0');

    if (!aId || !bId) throw badRequest("Missing IDs");

    const getParticipant = async (id: number) => {
        const p = await prisma.participant.findUnique({
            where: { id },
            include: {
                household: {
                    include: {
                        participants: true,
                        leads: true
                    }
                },
                _count: {
                    select: {
                        rawBadgeEvents: true,
                        visits: true,
                        programParticipants: true,
                        programVolunteers: true
                    }
                }
            }
        });
        return p;
    };

    const [pA, pB] = await Promise.all([getParticipant(aId), getParticipant(bId)]);

    if (!pA || !pB) throw notFound("Participant not found");

    return { Participant: [pA, pB] };
});
