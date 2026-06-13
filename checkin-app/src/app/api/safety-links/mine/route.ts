import prisma from "@/lib/prisma";
import { handler, unauthorized } from "@/security/handler";

export const dynamic = "force-dynamic";

/**
 * GET /api/safety-links/mine — the caller's own disclosed relationships and their
 * review history. Field visibility is governed by the security registry: the
 * subject sees their_own personal fields (relationship, conditions, status,
 * dates) but never the board's internal notes.
 */
export const GET = handler("GET /api/safety-links/mine", async ({ auth }) => {
    if (auth.type !== "session") throw unauthorized();
    const links = await prisma.safetyLink.findMany({
        where: { subjectParticipantId: auth.user.id },
        orderBy: { createdAt: "desc" },
        select: {
            id: true,
            subjectParticipantId: true,
            counterpartyParticipantId: true,
            counterpartyName: true,
            counterpartyContact: true,
            relationshipType: true,
            description: true,
            createdAt: true,
            reviews: {
                orderBy: { id: "desc" },
                select: {
                    id: true,
                    safetyLinkId: true,
                    subjectParticipantId: true,
                    kind: true,
                    status: true,
                    conditions: true,
                    effectiveFrom: true,
                    reviewBy: true,
                    createdAt: true,
                },
            },
        },
    });
    return { SafetyLink: links };
});
