import { isProgramCheckoutBroken, PROGRAM_CHECKOUT_BROKEN_WHERE } from "@/lib/programCheckout";

describe("isProgramCheckoutBroken", () => {
  it("free program (no prices) is never broken", () => {
    expect(isProgramCheckoutBroken({
      orgMemberPriceCents: null, nonOrgMemberPriceCents: null,
      shopifyOrgMemberVariantId: null, shopifyNonOrgMemberVariantId: null,
    })).toBe(false);
  });

  it("both tiers priced with both variants is not broken", () => {
    expect(isProgramCheckoutBroken({
      orgMemberPriceCents: 5000, nonOrgMemberPriceCents: 8000,
      shopifyOrgMemberVariantId: "gid-1", shopifyNonOrgMemberVariantId: "gid-2",
    })).toBe(false);
  });

  it("priced org tier with a null org variant is broken", () => {
    expect(isProgramCheckoutBroken({
      orgMemberPriceCents: 5000, nonOrgMemberPriceCents: null,
      shopifyOrgMemberVariantId: null, shopifyNonOrgMemberVariantId: null,
    })).toBe(true);
  });

  it("priced non-org tier with a null non-org variant is broken", () => {
    expect(isProgramCheckoutBroken({
      orgMemberPriceCents: null, nonOrgMemberPriceCents: 8000,
      shopifyOrgMemberVariantId: null, shopifyNonOrgMemberVariantId: null,
    })).toBe(true);
  });

  it("partial: org configured, non-org priced but missing its variant is broken", () => {
    expect(isProgramCheckoutBroken({
      orgMemberPriceCents: 5000, nonOrgMemberPriceCents: 8000,
      shopifyOrgMemberVariantId: "gid-1", shopifyNonOrgMemberVariantId: null,
    })).toBe(true);
  });

  it("a missing variant on a FREE tier does not flag (gate on price > 0)", () => {
    // Org tier free (null price) with no org variant, non-org fully configured.
    expect(isProgramCheckoutBroken({
      orgMemberPriceCents: null, nonOrgMemberPriceCents: 8000,
      shopifyOrgMemberVariantId: null, shopifyNonOrgMemberVariantId: "gid-2",
    })).toBe(false);
  });

  it("zero price is treated as free, not broken", () => {
    expect(isProgramCheckoutBroken({
      orgMemberPriceCents: 0, nonOrgMemberPriceCents: 0,
      shopifyOrgMemberVariantId: null, shopifyNonOrgMemberVariantId: null,
    })).toBe(false);
  });

  // Single-pool model (product decision 2026-07-06): shopifyVariantId alone
  // covers both tiers — never flag broken when it's set, regardless of the
  // legacy pair's state.
  it("shopifyVariantId set covers both priced tiers — not broken", () => {
    expect(isProgramCheckoutBroken({
      orgMemberPriceCents: 5000, nonOrgMemberPriceCents: 8000,
      shopifyVariantId: "single-pool-gid",
      shopifyOrgMemberVariantId: null, shopifyNonOrgMemberVariantId: null,
    })).toBe(false);
  });

  it("a priced program with neither shopifyVariantId nor a legacy variant is broken", () => {
    expect(isProgramCheckoutBroken({
      orgMemberPriceCents: 5000, nonOrgMemberPriceCents: 8000,
      shopifyVariantId: null,
      shopifyOrgMemberVariantId: null, shopifyNonOrgMemberVariantId: null,
    })).toBe(true);
  });
});

// ── predicate ≡ WHERE ────────────────────────────────────────────────────────
// The count query (nav todo-counts) runs PROGRAM_CHECKOUT_BROKEN_WHERE in
// Postgres; the list/detail UI runs isProgramCheckoutBroken in JS. If they
// disagree the badge count contradicts the list it links to, so assert them
// equal over the whole matrix rather than trusting the two to be edited together.

type Row = {
  orgMemberPriceCents: number | null;
  nonOrgMemberPriceCents: number | null;
  shopifyVariantId: string | null;
  shopifyOrgMemberVariantId: string | null;
  shopifyNonOrgMemberVariantId: string | null;
};

/**
 * Evaluate the subset of Prisma `where` grammar this fragment uses against a row,
 * with SQL null semantics: `field: null` is IS NULL, and `{ gt: n }` on a NULL
 * column is unknown → no match.
 */
function whereMatches(where: Record<string, unknown>, row: Row): boolean {
  for (const [key, clause] of Object.entries(where)) {
    if (key === "OR") {
      if (!(clause as Record<string, unknown>[]).some((c) => whereMatches(c, row))) return false;
      continue;
    }
    const value = (row as unknown as Record<string, unknown>)[key];
    if (clause === null) {
      if (value !== null && value !== undefined) return false;
    } else if (clause && typeof clause === "object" && typeof (clause as { gt?: unknown }).gt === "number") {
      const { gt } = clause as { gt: number };
      if (typeof value !== "number" || !(value > gt)) return false;
    } else {
      throw new Error(`whereMatches: unhandled shape for ${key}: ${JSON.stringify(clause)}`);
    }
  }
  return true;
}

describe("PROGRAM_CHECKOUT_BROKEN_WHERE agrees with isProgramCheckoutBroken", () => {
  const PRICES = [null, 0, 5000];
  const VARIANTS = [null, "gid-1"];

  it("matches the predicate on every price × variant combination", () => {
    for (const orgMemberPriceCents of PRICES) {
      for (const nonOrgMemberPriceCents of PRICES) {
        for (const shopifyVariantId of VARIANTS) {
          for (const shopifyOrgMemberVariantId of VARIANTS) {
            for (const shopifyNonOrgMemberVariantId of VARIANTS) {
              const row: Row = {
                orgMemberPriceCents, nonOrgMemberPriceCents, shopifyVariantId,
                shopifyOrgMemberVariantId, shopifyNonOrgMemberVariantId,
              };
              const query = whereMatches(
                PROGRAM_CHECKOUT_BROKEN_WHERE as Record<string, unknown>,
                row,
              );
              expect({ row, broken: query }).toEqual({ row, broken: isProgramCheckoutBroken(row) });
            }
          }
        }
      }
    }
  });
});
