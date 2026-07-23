import prisma from "@/lib/prisma";
import { handler } from "@/security/handler";
import { LIVE_PERSON } from "@/lib/person/filters";

// Emergency board contact sheet for the front desk. Keyholders receive email +
// phone here — deliberate and owner-confirmed, declared as the registry's
// 'keyholders:pii' grant rather than hand-rolled in this query. The select
// stays tight as defense in depth: dateOfBirth and googleId must never enter
// this response even for a sysadmin caller whose view would grant them.
//
// LIVE_PERSON is load-bearing: a merged-away board member keeps its row as a
// tombstone, and without the filter it would reappear on the front-desk
// contact sheet with email + phone. Human-facing list, so it filters.
export const GET = handler('GET /api/safety/board-contacts', async () => {
    const members = await prisma.person.findMany({
        where: { isBoardMember: true, ...LIVE_PERSON },
        select: { id: true, name: true, phone: true, email: true },
        orderBy: { name: "asc" },
    });
    return { Person: members };
});
