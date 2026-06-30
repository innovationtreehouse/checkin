import prisma from "@/lib/prisma";
import { handler, badRequest, notFound } from "@/security/handler";

export const dynamic = 'force-dynamic';

/**
 * GET /api/membership-ops/participants/merge/analyze — side-by-side view of two
 * participants the admin is considering merging (household + activity counts).
 *
 * Field visibility is governed by the security registry (sysadmin/board get the
 * full participant PII; anyone else admitted would be stripped to public). The bag
 * is keyed by model name so the stripper can classify it; the 'participants'
 * envelope preserves the response shape the merge page consumes.
 */
export const GET = handler('GET /api/membership-ops/participants/merge/analyze', async ({ req }) => {
    const url = new URL(req.url);
    const aId = parseInt(url.searchParams.get('a') || '0');
    const bId = parseInt(url.searchParams.get('b') || '0');

    if (!aId || !bId) throw badRequest('Missing IDs');

    const getParticipant = (id: number) => prisma.participant.findUnique({
        where: { id },
        include: {
            household: {
                include: {
                    participants: true,
                    leads: true,
                },
            },
            _count: {
                select: {
                    rawBadgeLogs: true,
                    visits: true,
                    programParticipants: true,
                    programVolunteers: true,
                },
            },
        },
    });

    const [pA, pB] = await Promise.all([getParticipant(aId), getParticipant(bId)]);

    if (!pA || !pB) throw notFound('Participant not found');

    return { Participant: [pA, pB] };
});
