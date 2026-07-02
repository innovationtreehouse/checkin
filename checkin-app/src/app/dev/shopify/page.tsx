import { notFound } from "next/navigation";
import prisma from "@/lib/prisma";
import { config } from "@/lib/config";
import DevShopifyClient from "./DevShopifyClient";

export const dynamic = "force-dynamic";

/**
 * Dev-only stand-in for a Shopify orders/paid webhook (see
 * docs/designs/SHOPIFY_DEV_STORE_WEBHOOK.md §6). Lists the processes currently
 * awaiting payment and fires a synthesized-but-real webhook for the chosen one.
 * 404s the moment the mock isn't active (always in prod).
 */
export default async function DevShopifyPage() {
    if (!config.shopifyMockActive()) notFound();

    const processes = await prisma.membershipProcess.findMany({
        where: { status: "PENDING_PAYMENT" },
        orderBy: { id: "desc" },
        select: { id: true, membership: { select: { household: { select: { name: true } }, isVolunteer: true } } },
    });

    const settings = await prisma.boardSettings.findUnique({ where: { id: 1 } });
    const hasVariant = !!(settings?.membershipVariantId ?? settings?.shopifyNormalVariantId ?? settings?.shopifyVolunteerVariantId);

    return (
        <DevShopifyClient
            hasVariant={hasVariant}
            processes={processes.map((p) => ({
                id: p.id,
                household: p.membership.household?.name ?? "(unnamed household)",
                isVolunteer: p.membership.isVolunteer,
            }))}
        />
    );
}
