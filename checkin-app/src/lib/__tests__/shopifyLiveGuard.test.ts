/**
 * The dev-store-only guard for the Shopify LIVE suite. The live tests never run
 * in CI, but the guard MUST — it's the thing standing between the suite and the
 * production store, so it gets covered by the normal unit run.
 */
import { assertLiveTestStore, PROD_STORE_DOMAIN } from "../../../shopify-live/guard";

const DEV = "treehouse-dev-4folhtgx.myshopify.com";

const base = {
    SHOPIFY_STORE_DOMAIN: DEV,
    SHOPIFY_LIVE_ALLOWED_DOMAIN: DEV,
    SHOPIFY_CLIENT_ID: "cid",
    SHOPIFY_CLIENT_SECRET: "csec",
} as unknown as NodeJS.ProcessEnv;

describe("assertLiveTestStore", () => {
    it("passes for the dev store with the double key set", () => {
        expect(assertLiveTestStore(base)).toBe(DEV);
    });

    it("REFUSES the production store even when every other variable allows it", () => {
        expect(() =>
            assertLiveTestStore({ ...base, SHOPIFY_STORE_DOMAIN: PROD_STORE_DOMAIN, SHOPIFY_LIVE_ALLOWED_DOMAIN: PROD_STORE_DOMAIN }),
        ).toThrow(/REFUSING.*production/);
    });

    it("refuses when the allowed-domain second key is the production store", () => {
        expect(() =>
            assertLiveTestStore({ ...base, SHOPIFY_LIVE_ALLOWED_DOMAIN: PROD_STORE_DOMAIN }),
        ).toThrow(/never be the production store/);
    });

    it("refuses on a domain/allowed-domain mismatch (single-edit retarget)", () => {
        expect(() =>
            assertLiveTestStore({ ...base, SHOPIFY_STORE_DOMAIN: "other-store.myshopify.com" }),
        ).toThrow(/!= SHOPIFY_LIVE_ALLOWED_DOMAIN/);
    });

    it("refuses when the allowed-domain key is missing entirely", () => {
        const env = { ...base } as NodeJS.ProcessEnv;
        delete env.SHOPIFY_LIVE_ALLOWED_DOMAIN;
        expect(() => assertLiveTestStore(env)).toThrow(/SHOPIFY_LIVE_ALLOWED_DOMAIN is not set/);
    });

    it("refuses when credentials are missing", () => {
        const env = { ...base } as NodeJS.ProcessEnv;
        delete env.SHOPIFY_CLIENT_SECRET;
        expect(() => assertLiveTestStore(env)).toThrow(/missing SHOPIFY_STORE_DOMAIN/);
    });

    it("refuses non-myshopify domains", () => {
        expect(() =>
            assertLiveTestStore({ ...base, SHOPIFY_STORE_DOMAIN: "evil.example.com", SHOPIFY_LIVE_ALLOWED_DOMAIN: "evil.example.com" }),
        ).toThrow(/not a \*\.myshopify\.com/);
    });
});
