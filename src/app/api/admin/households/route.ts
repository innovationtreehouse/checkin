import prisma from "@/lib/prisma";
import { handler, badRequest } from "@/security/handler";

export const dynamic = 'force-dynamic';

export const GET = handler('GET /api/admin/households', async ({ req }) => {
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    const q = url.searchParams.get('q') || '';

    if (id) {
        const household = await prisma.household.findUnique({
            where: { id: parseInt(id) },
            include: {
                participants: {
                    select: { id: true, name: true, email: true }
                },
                memberships: true
            }
        });
        return { Household: household };
    }

    const whereClause = q ? {
        OR: [
            { name: { contains: q, mode: 'insensitive' as const } },
            { participants: { some: { name: { contains: q, mode: 'insensitive' as const } } } },
            { participants: { some: { email: { contains: q, mode: 'insensitive' as const } } } },
        ]
    } : {};

    const households = await prisma.household.findMany({
        where: whereClause,
        include: {
            participants: {
                select: { id: true, name: true, email: true }
            },
            memberships: true
        },
        orderBy: {
            id: 'desc'
        },
        ...(q && { take: 20 })
    });

    return { Household: households };
});

export const POST = handler('POST /api/admin/households', async ({ req }) => {
    const body = await req.json();
    const { householdId, active } = body;

    if (!householdId) throw badRequest("Household ID is required");

    const existingMembership = await prisma.membership.findFirst({
        where: { householdId, active: true },
        orderBy: { since: "desc" }
    });

    if (active && !existingMembership) {
        const membership = await prisma.membership.create({
            data: {
                householdId,
                type: "HOUSEHOLD",
                active: true
            }
        });
        return { Membership: membership };
    } else if (!active && existingMembership) {
        const updated = await prisma.membership.update({
            where: { id: existingMembership.id },
            data: { active: false }
        });
        await prisma.membership.updateMany({
            where: { householdId, id: { not: existingMembership.id }, active: true },
            data: { active: false }
        });
        return { Membership: updated };
    }

    return { Membership: existingMembership };
});
