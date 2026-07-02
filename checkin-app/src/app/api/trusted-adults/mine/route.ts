import prisma from "@/lib/prisma";
import { handler, unauthorized } from "@/security/handler";

export const dynamic = "force-dynamic";

/**
 * GET /api/trusted-adults/mine — the caller's household trusted adults and their
 * review history. Field visibility is governed by the security registry: the
 * household sees familyContext (pii band) + the board's shared note (personal) +
 * status/dates, but never the board's internal decision notes.
 */
export const GET = handler("GET /api/trusted-adults/mine", async ({ auth }) => {
    if (auth.type !== "session") throw unauthorized();
    const trustedAdults = await prisma.trustedAdult.findMany({
        where: { householdId: auth.user.householdId },
        orderBy: { createdAt: "desc" },
        select: {
            id: true,
            householdId: true,
            trustedAdultPersonId: true,
            trustedAdultName: true,
            trustedAdultPhone: true,
            trustedAdultEmail: true,
            familyContext: true,
            createdAt: true,
            reviews: {
                orderBy: { id: "desc" },
                select: {
                    id: true,
                    trustedAdultId: true,
                    householdId: true,
                    kind: true,
                    status: true,
                    sharedNote: true,
                    effectiveFrom: true,
                    reviewBy: true,
                    createdAt: true,
                },
            },
        },
    });
    return { TrustedAdult: trustedAdults };
});
