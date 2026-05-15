import prisma from "@/lib/prisma";
import { handler, forbidden, unauthorized } from "@/security/handler";

export const dynamic = 'force-dynamic';

export const GET = handler('GET /api/shop/members', async ({ auth }) => {
    if (auth.type !== 'session') throw unauthorized();

    const userWithCerts = await prisma.participant.findUnique({
        where: { id: auth.user.id },
        select: { toolStatuses: { select: { level: true } } }
    });
    const hasCertifierAuth = (userWithCerts?.toolStatuses || []).some(ts => ts.level === 'MAY_CERTIFY_OTHERS');

    const isAuthorized = auth.user.sysadmin ||
        auth.user.boardMember ||
        auth.user.shopSteward ||
        hasCertifierAuth;

    if (!isAuthorized) {
        throw forbidden("Forbidden: Requires Shop Steward, Admin, or Certifier role");
    }

    const members = await prisma.participant.findMany({
        where: {
            OR: [
                { household: { memberships: { some: { active: true } } } },
                { memberships: { some: { active: true } } }
            ]
        },
        select: {
            id: true,
            name: true,
            email: true,
        },
        orderBy: {
            name: 'asc'
        }
    });

    return { Participant: members };
});
