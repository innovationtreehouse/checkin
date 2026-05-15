import prisma from "@/lib/prisma";
import { handler, unauthorized } from "@/security/handler";

export const GET = handler('GET /api/profile/visits', async ({ req, auth }) => {
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

    const visits = await prisma.visit.findMany({
        where: {
            participantId: userId,
            arrived: {
                gte: startDate,
                lte: endDate
            }
        },
        orderBy: { arrived: 'desc' },
        select: {
            id: true,
            participantId: true,
            arrived: true,
            departed: true,
            event: { select: { name: true } }
        }
    });

    return { Visit: visits };
});
