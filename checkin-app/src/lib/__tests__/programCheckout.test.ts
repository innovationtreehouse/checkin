import { isProgramCheckoutBroken } from "@/lib/programCheckout";

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
