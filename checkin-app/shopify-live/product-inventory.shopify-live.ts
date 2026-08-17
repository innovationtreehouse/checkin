/**
 * @jest-environment node
 */
/**
 * LIVE contract: single-pool product creation + relative inventory adjustment,
 * exercised through the app's real lib functions against the real dev store.
 * These are the exact call sequences the capacity model (#930,
 * docs/PROGRAM_CAPACITY_AND_SCHOLARSHIPS.md) depends on.
 */
// The lib's failure path reports through prisma + email — keep the live suite
// DB- and mail-free (a live failure should fail the test, not email the board).
jest.mock("@/lib/prisma", () => ({ __esModule: true, default: {} }));
jest.mock("@/lib/email", () => ({ sendEmail: jest.fn() }));

import { createShopifySingleVariantProgram, adjustProgramInventory } from "@/lib/shopify";
import {
    ensureLiveStore,
    testRunName,
    trackProduct,
    cleanupTracked,
    getVariant,
    getAvailable,
} from "./helpers";

const MAX_PARTICIPANTS = 5;

describe("live: single-pool product + inventory contract", () => {
    let productId: string;
    let variantId: string;

    beforeAll(() => {
        ensureLiveStore();
    });

    afterAll(async () => {
        await cleanupTracked();
    });

    it("createShopifySingleVariantProgram creates an active product with a managed, deny-policy variant", async () => {
        const created = await createShopifySingleVariantProgram(testRunName("prodinv"), 2500, MAX_PARTICIPANTS);
        expect(created).not.toBeNull();
        productId = created!.shopifyProductId;
        variantId = created!.shopifyVariantId;
        trackProduct(productId);

        const variant = await getVariant(variantId);
        expect(String(variant.product_id)).toBe(productId);
        expect(variant.price).toBe("25.00");
        // The capacity model's load-bearing settings: Shopify tracks the count
        // and REFUSES oversell (policy deny) — see #930.
        expect(variant.inventory_management).toBe("shopify");
        expect(variant.inventory_policy).toBe("deny");
    });

    it("seeds initial inventory to maxParticipants", async () => {
        const variant = await getVariant(variantId);
        expect(await getAvailable(variant.inventory_item_id)).toBe(MAX_PARTICIPANTS);
    });

    it("adjustProgramInventory applies RELATIVE deltas (scholarship hold -1, release +1)", async () => {
        const program = { shopifyVariantId: variantId };
        const variant = await getVariant(variantId);

        expect(await adjustProgramInventory(program, -1)).toBe(true);
        expect(await getAvailable(variant.inventory_item_id)).toBe(MAX_PARTICIPANTS - 1);

        expect(await adjustProgramInventory(program, +1)).toBe(true);
        expect(await getAvailable(variant.inventory_item_id)).toBe(MAX_PARTICIPANTS);
    });

    it("free programs (no price) create nothing", async () => {
        expect(await createShopifySingleVariantProgram(testRunName("free"), null, 5)).toBeNull();
        expect(await createShopifySingleVariantProgram(testRunName("zero"), 0, 5)).toBeNull();
    });
});
