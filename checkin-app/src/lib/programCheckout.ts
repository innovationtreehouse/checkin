import type { Prisma } from "@/generated/prisma/client";

/**
 * A program is "checkout-broken" when it has a price on a tier but no matching
 * Shopify variant to sell it — paid enrollment silently can't complete (the
 * parent can't pay; the orders/paid webhook never fires, so the participant sits
 * PENDING forever). This state exists because variant IDs are minted only at
 * program-create time (api/programs POST); a program made free, then priced via
 * edit (api/programs/[id] PATCH), never gets variants.
 *
 * FREE tiers legitimately have no variant, so gate on the tier's price being > 0
 * — never flag on a missing variant alone.
 *
 * The JS predicate and the Prisma WHERE below MUST stay in lockstep: the count
 * query (nav/todo-counts) and the per-row/detail UI are the same condition on two
 * sides of the wire. Change one, change the other. programCheckout.test.ts guards
 * the predicate.
 */
type CheckoutFields = {
  orgMemberPriceCents?: number | null;
  nonOrgMemberPriceCents?: number | null;
  shopifyOrgMemberVariantId?: string | null;
  shopifyNonOrgMemberVariantId?: string | null;
};

export function isProgramCheckoutBroken(p: CheckoutFields): boolean {
  return (
    ((p.orgMemberPriceCents ?? 0) > 0 && !p.shopifyOrgMemberVariantId) ||
    ((p.nonOrgMemberPriceCents ?? 0) > 0 && !p.shopifyNonOrgMemberVariantId)
  );
}

export const PROGRAM_CHECKOUT_BROKEN_WHERE: Prisma.ProgramWhereInput = {
  OR: [
    { orgMemberPriceCents: { gt: 0 }, shopifyOrgMemberVariantId: null },
    { nonOrgMemberPriceCents: { gt: 0 }, shopifyNonOrgMemberVariantId: null },
  ],
};
