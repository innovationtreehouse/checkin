import prisma from "@/lib/prisma";
import { handler } from "@/security/handler";

export const GET = handler('GET /api/directory/board', async () => {
    const boardMembers = await prisma.participant.findMany({
        where: { isBoardMember: true },
        // Defense in depth: a directory must never load pii (dob, googleId) even
        // for callers the stripper would clear. Select only what a board
        // directory needs; email/phone still get stripped for keyholders.
        select: { id: true, name: true, isBoardMember: true, email: true, phone: true },
        orderBy: { name: 'asc' },
    });
    return { Participant: boardMembers };
});
