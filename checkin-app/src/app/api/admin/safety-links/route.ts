import prisma from "@/lib/prisma";
import { handler } from "@/security/handler";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/safety-links — the board's review queue: every link with a
 * review awaiting board action, awaiting the subject, or expired (needing
 * renewal). Exposes subject + counterparty PII, so only sysadmin/board are
 * admitted and the field grant is explicit per role in the registry.
 */
export const GET = handler("GET /api/admin/safety-links", async () => {
    const links = await prisma.safetyLink.findMany({
        where: {
            reviews: { some: { status: { in: ["PENDING_BOARD_REVIEW", "PENDING_SUBJECT_ACTION", "EXPIRED"] } } },
        },
        orderBy: { createdAt: "desc" },
        select: {
            id: true,
            subjectParticipantId: true,
            counterpartyParticipantId: true,
            counterpartyName: true,
            counterpartyContact: true,
            relationshipType: true,
            description: true,
            origin: true,
            createdAt: true,
            subject: { select: { id: true, name: true, email: true } },
            counterparty: { select: { id: true, name: true, email: true } },
            reviews: {
                orderBy: { id: "desc" },
                select: {
                    id: true,
                    safetyLinkId: true,
                    subjectParticipantId: true,
                    kind: true,
                    status: true,
                    decision: true,
                    decisionNote: true,
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
