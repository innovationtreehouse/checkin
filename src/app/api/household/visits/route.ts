import prisma from "@/lib/prisma";
import { handler, unauthorized } from "@/security/handler";

export const GET = handler('GET /api/household/visits', async ({ req, auth }) => {
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

    const user = await prisma.participant.findUnique({
        where: { id: userId },
        select: { householdId: true }
    });

    if (!user || !user.householdId) {
        return { Visit: [] };
    }

    const visits = await prisma.visit.findMany({
        where: {
            participant: {
                householdId: user.householdId
            },
            arrived: {
                gte: startDate,
                lte: endDate
            }
        },
        orderBy: { arrived: 'desc' },
        include: {
            participant: { select: { id: true, name: true, householdId: true } },
            event: { select: { id: true, name: true } }
        }
    });

    return { Visit: visits };
});
