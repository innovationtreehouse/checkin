import prisma from "@/lib/prisma";
import { handler, unauthorized } from "@/security/handler";

export const dynamic = "force-dynamic";

/**
 * GET /api/trusted-adults/mine — the caller's household trusted adults and their
 * review history. Field visibility is governed by the security registry: the
 * household sees familyContext (internal — narrative band, granted via
 * their_households:internal) + the board's shared note (personal) + status/
 * dates. The board's private decision/decisionNote are ALSO internal-tier and
 * therefore inside that grant on paper — this SELECT is what keeps them out.
 * Do not add decision/decisionNote here (pinned by the integration test
 * "the family sees familyContext + the board shared note, not internal
 * fields").
 */
export const GET = handler("GET /api/trusted-adults/mine", async ({ auth }) => {
    if (auth.type !== "session") throw unauthorized();
    const trustedAdults = await prisma.trustedAdult.findMany({
        where: { householdId: auth.user.householdId, hiddenAt: null },
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
                    proposedName: true,
                    proposedPhone: true,
                    proposedEmail: true,
                    proposedContext: true,
                    createdAt: true,
                },
            },
        },
    });
    return { TrustedAdult: trustedAdults };
});
