import prisma from "@/lib/prisma";
import { handler } from "@/security/handler";

export const dynamic = "force-dynamic";

/**
 * GET /api/membership-ops/applications — in-flight membership applications for the board.
 * Every process not yet ACTIVE, with its household + external-phase flags.
 *
 * Field visibility is governed by the security registry (isSysadmin/board get the
 * full applicant PII; anyone else admitted would be stripped to public). The bag
 * is keyed by the model name so the stripper can classify it; the 'processes'
 * envelope preserves the response shape consumers expect.
 */
export const GET = handler("GET /api/membership-ops/applications", async () => {
    const processes = await prisma.orgMembershipProcess.findMany({
        where: { status: { notIn: ["ACTIVE", "ARCHIVED"] } },
        orderBy: { createdAt: "desc" },
        select: {
            id: true,
            kind: true,
            status: true,
            createdAt: true,
            zohoEnvelopeId: true,
            contractSignedAt: true,
            bgConsentAt: true,
            bgClearedAt: true,
            paidAt: true,
            attestations: { select: { id: true, result: true, isMarkedVolunteer: true } },
            orgMembership: {
                select: {
                    householdId: true,
                    isVolunteer: true,
                    household: {
                        select: {
                            name: true,
                            householdMembers: { select: { id: true, name: true, email: true, isHouseholdLead: true } },
                        },
                    },
                },
            },
        },
    });

    return { OrgMembershipProcess: processes };
});
