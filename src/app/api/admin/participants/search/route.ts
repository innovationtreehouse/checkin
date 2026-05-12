import prisma from "@/lib/prisma";
import { handler } from "@/security/handler";

export const dynamic = 'force-dynamic';

export const GET = handler('GET /api/admin/participants/search', async ({ req }) => {
    const url = new URL(req.url);
    const q = url.searchParams.get('q') || '';

    const participants = await prisma.participant.findMany({
        where: q ? {
            OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { email: { contains: q, mode: 'insensitive' } },
            ]
        } : {},
        take: 200,
        orderBy: { id: 'desc' },
        include: {
            memberships: {
                where: { active: true }
            },
            household: {
                include: {
                    participants: true
                }
            }
        }
    });

    return { Participant: participants };
});
