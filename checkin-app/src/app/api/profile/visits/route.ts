import prisma from "@/lib/prisma";
import { handler, unauthorized } from "@/security/handler";

// Registry-governed (GET /api/profile/visits): admission 'authenticated';
// view grants their_own:personal only — arrivedAt/departedAt (personal tier)
// are visible solely on the caller's OWN rows. The select includes personId
// because the Visit their_own binding keys on row.personId: without it the
// scope fails closed and the timestamps strip (over-restriction, not a leak).
export const GET = handler('GET /api/profile/visits', async ({ req, auth }) => {
    // Defense in depth: the registry admission gate already requires a
    // session; keep the in-handler check anyway.
    if (auth.type !== 'session') throw unauthorized();
    const userId = auth.user.id;

    const { searchParams } = new URL(req.url);
    const filterDateStr = searchParams.get('date');

    let startDate: Date;
    let endDate: Date;

    if (filterDateStr) {
        const baseDate = new Date(filterDateStr);
        startDate = new Date(baseDate);
        startDate.setDate(baseDate.getDate() - 7);
        endDate = new Date(baseDate);
        endDate.setDate(baseDate.getDate() + 7);
    } else {
        endDate = new Date();
        startDate = new Date();
        startDate.setDate(endDate.getDate() - 7);
    }

    // Row filter (security-critical, stays query-side per #1134): own rows
    // only, ±7-day window.
    const visits = await prisma.visit.findMany({
        where: {
            personId: userId,
            arrivedAt: {
                gte: startDate,
                lte: endDate
            }
        },
        orderBy: { arrivedAt: 'desc' },
        select: {
            id: true,
            personId: true,
            arrivedAt: true,
            departedAt: true,
            event: { select: { name: true } }
        }
    });

    return { Visit: visits };
});
