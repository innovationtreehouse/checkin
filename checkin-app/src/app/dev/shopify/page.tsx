import { notFound } from "next/navigation";
import prisma from "@/lib/prisma";
import { config } from "@/lib/config";
import DevShopifyClient from "./DevShopifyClient";

export const dynamic = "force-dynamic";

/**
 * Dev-only stand-in for a Shopify orders/paid webhook (see
 * docs/designs/SHOPIFY_DEV_STORE_WEBHOOK.md §6). Lists the membership processes
 * AND program enrollments currently awaiting payment and fires a
 * synthesized-but-real webhook for the chosen one. 404s the moment the mock
 * isn't active (always in prod).
 */
export default async function DevShopifyPage() {
    if (!config.shopifyMockActive()) notFound();

    const processes = await prisma.orgMembershipProcess.findMany({
        where: { status: "PENDING_PAYMENT" },
        orderBy: { id: "desc" },
        select: { id: true, orgMembership: { select: { household: { select: { name: true } }, isVolunteer: true } } },
    });

    const settings = await prisma.boardSettings.findUnique({ where: { id: 1 } });
    const hasVariant = !!(settings?.orgMembershipVariantId ?? settings?.shopifyNormalVariantId ?? settings?.shopifyVolunteerVariantId);

    const pendingParticipants = await prisma.programParticipant.findMany({
        where: { status: "PENDING" },
        orderBy: [{ programId: "desc" }, { personId: "asc" }],
        select: {
            personId: true,
            person: { select: { name: true } },
            program: {
                select: { id: true, name: true, shopifyOrgMemberVariantId: true, shopifyNonOrgMemberVariantId: true },
            },
        },
    });

    return (
        <DevShopifyClient
            hasVariant={hasVariant}
            processes={processes.map((p) => ({
                id: p.id,
                household: p.orgMembership.household?.name ?? "(unnamed household)",
                isVolunteer: p.orgMembership.isVolunteer,
            }))}
            enrollments={pendingParticipants.map((pp) => ({
                programId: pp.program.id,
                programName: pp.program.name,
                personId: pp.personId,
                personName: pp.person.name ?? `Person #${pp.personId}`,
                hasVariant: !!(pp.program.shopifyOrgMemberVariantId ?? pp.program.shopifyNonOrgMemberVariantId),
            }))}
        />
    );
}
