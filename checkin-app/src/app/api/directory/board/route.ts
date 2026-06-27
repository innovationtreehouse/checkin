import prisma from "@/lib/prisma";
import { handler } from "@/security/handler";

export const GET = handler('GET /api/directory/board', async () => {
    const boardMembers = await prisma.participant.findMany({
        where: { boardMember: true },
        orderBy: { name: 'asc' },
    });
    return { Participant: boardMembers };
});
