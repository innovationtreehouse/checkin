/**
 * @jest-environment node
 */
/**
 * LIVE contract: the member-discount price rule minted for single-pool member
 * checkout. The per-unit pricing of multi-child household carts hangs entirely
 * on allocation_method 'each' semantics (see the #930 review) — this pins the
 * rule configuration Shopify actually stores, not what we think we sent.
 */
jest.mock("@/lib/prisma", () => ({ __esModule: true, default: {} }));
jest.mock("@/lib/email", () => ({ sendEmail: jest.fn() }));

import { createShopifySingleVariantProgram, mintMemberDiscountCode } from "@/lib/shopify";
import { CITEST_PROGRAM_ID_BASE } from "./guard";
import {
    ensureLiveStore,
    testRunName,
    trackProduct,
    trackPriceRule,
    cleanupTracked,
    findPriceRuleByTitle,
} from "./helpers";

describe("live: member discount price-rule contract", () => {
    let variantId: string;

    beforeAll(async () => {
        ensureLiveStore();
        const created = await createShopifySingleVariantProgram(testRunName("discount"), 5000, 3);
        expect(created).not.toBeNull();
        trackProduct(created!.shopifyProductId);
        variantId = created!.shopifyVariantId;
    });

    afterAll(async () => {
        await cleanupTracked();
    });

    it("mints a code whose stored rule is fixed_amount, per-unit ('each'), scoped to the variant, single-use", async () => {
        // programId from the janitor-recognizable reserved range (PRG9999999xx-…).
        const code = await mintMemberDiscountCode(CITEST_PROGRAM_ID_BASE + 1, variantId, 1000);
        expect(code).toMatch(new RegExp(`^PRG${CITEST_PROGRAM_ID_BASE + 1}-[0-9A-F]{8}$`));

        const rule = await findPriceRuleByTitle(code!);
        expect(rule).not.toBeNull();
        trackPriceRule(rule!.id);

        // The load-bearing semantics for multi-child member carts (variant:N):
        // fixed_amount + 'each' takes the amount off EVERY unit; 'across' would
        // subtract it once from the whole line (the overcharge bug class).
        expect(rule!.value_type).toBe("fixed_amount");
        expect(rule!.value).toBe("-10.00");
        expect(rule!.allocation_method).toBe("each");
        expect(rule!.target_type).toBe("line_item");
        expect(rule!.target_selection).toBe("entitled");
        expect(rule!.entitled_variant_ids.map(String)).toEqual([variantId]);
        expect(rule!.usage_limit).toBe(1);
        expect(rule!.once_per_customer).toBe(true);
        // ~48h validity window per design.
        const windowMs = new Date(rule!.ends_at!).getTime() - new Date(rule!.starts_at).getTime();
        expect(windowMs).toBeGreaterThan(47 * 60 * 60 * 1000);
        expect(windowMs).toBeLessThan(49 * 60 * 60 * 1000);
    });

    it("returns null (no rule) for a zero discount", async () => {
        expect(await mintMemberDiscountCode(CITEST_PROGRAM_ID_BASE + 2, variantId, 0)).toBeNull();
    });
});
