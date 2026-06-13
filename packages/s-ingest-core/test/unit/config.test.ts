/**
 * Unit tests for config loading. Both loaders take an explicit env object, so they are
 * pure and need no process.env manipulation. The split exists so the loader/inject path
 * (DB only) never trips over missing Shopify credentials — both halves are covered here.
 */
import { describe, it, expect } from "vitest";
import { loadDbConfig, loadShopifyConfig } from "../../src/config.js";

describe("loadDbConfig", () => {
  it("loads the database url and derives storeId from STORE_ID", () => {
    const cfg = loadDbConfig({ SHOPIFY_READ_DATABASE_URL: "postgresql://x", STORE_ID: "explicit-store" } as NodeJS.ProcessEnv);
    expect(cfg.databaseUrl).toBe("postgresql://x");
    expect(cfg.storeId).toBe("explicit-store");
  });

  it("falls back to SHOPIFY_SHOP, then to 'default', for storeId", () => {
    expect(loadDbConfig({ SHOPIFY_READ_DATABASE_URL: "postgresql://x", SHOPIFY_SHOP: "shop.myshopify.com" } as NodeJS.ProcessEnv).storeId).toBe(
      "shop.myshopify.com",
    );
    expect(loadDbConfig({ SHOPIFY_READ_DATABASE_URL: "postgresql://x" } as NodeJS.ProcessEnv).storeId).toBe("default");
  });

  it("throws when SHOPIFY_READ_DATABASE_URL is missing (the loader/inject path's one hard requirement)", () => {
    expect(() => loadDbConfig({} as NodeJS.ProcessEnv)).toThrow();
  });
});

describe("loadShopifyConfig", () => {
  const base = {
    SHOPIFY_SHOP: "shop.myshopify.com",
    SHOPIFY_ADMIN_TOKEN: "tok",
    CUTOVER_DATE: "2026-01-01",
  } as NodeJS.ProcessEnv;

  it("loads credentials and derives the GraphQL endpoint from shop + apiVersion", () => {
    const cfg = loadShopifyConfig({ ...base, SHOPIFY_API_VERSION: "2025-07" });
    expect(cfg.shop).toBe("shop.myshopify.com");
    expect(cfg.adminToken).toBe("tok");
    expect(cfg.apiVersion).toBe("2025-07");
    expect(cfg.endpoint).toBe("https://shop.myshopify.com/admin/api/2025-07/graphql.json");
  });

  it("defaults SHOPIFY_API_VERSION when unset", () => {
    const cfg = loadShopifyConfig(base);
    expect(cfg.apiVersion).toBe("2025-07");
    expect(cfg.endpoint).toContain("/2025-07/");
  });

  it("throws when a required Shopify credential is missing", () => {
    expect(() => loadShopifyConfig({ SHOPIFY_ADMIN_TOKEN: "tok", CUTOVER_DATE: "2026-01-01" } as NodeJS.ProcessEnv)).toThrow();
    expect(() => loadShopifyConfig({ SHOPIFY_SHOP: "s", SHOPIFY_ADMIN_TOKEN: "tok" } as NodeJS.ProcessEnv)).toThrow();
  });
});
