import prisma from "@/lib/prisma";
import { handler } from "@/security/handler";

export const GET = handler('GET /api/admin/badges', async () => {
    const badges = await prisma.rawBadgeEvent.findMany({
        take: 200,
        orderBy: { time: "desc" },
        include: {
            participant: {
                select: { name: true, email: true },
            },
        },
    });
    return { RawBadgeEvent: badges };
});
