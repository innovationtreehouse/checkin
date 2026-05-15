import prisma from "@/lib/prisma";
import { handler } from "@/security/handler";

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/dev-personas
 *
 * Dev-only endpoint that returns all @example.com participants
 * with their role flags for the dev login picker.
 *
 * Gated by `authorize: 'dev-only'` — the framework returns 403 when
 * NEXT_PUBLIC_DEV_AUTH is unset. (The original handler returned 404
 * for the same condition; the frontend treats both identically.)
 */
export const GET = handler('GET /api/auth/dev-personas', async () => {
    const personas = await prisma.participant.findMany({
        where: {
            email: { endsWith: "@example.com" },
        },
        select: {
            id: true,
            email: true,
            name: true,
            sysadmin: true,
            boardMember: true,
            keyholder: true,
            shopSteward: true,
            dob: true,
            householdId: true,
            toolStatuses: {
                select: {
                    toolId: true,
                    level: true,
                },
            },
        },
        orderBy: { id: "asc" },
    });

    return personas as unknown as Record<string, unknown>;
});
