/**
 * Configuration / credential loading.
 *
 * Reads from process.env. Locally these come from a git-ignored `.env`
 * (loaded via `node --env-file=.env ...` in the npm scripts). In Lambda the
 * same variables are injected by the execution environment from the secret
 * store (Secrets Manager / SSM) — the code does not care which.
 *
 * Split into two loaders so the loader/inject path needs only the database and
 * never requires Shopify credentials to be present.
 */
import { z } from "zod";

const dbSchema = z.object({
  SHOPIFY_READ_DATABASE_URL: z.string().min(1, "SHOPIFY_READ_DATABASE_URL is required"),
  STORE_ID: z.string().min(1).optional(),
});

const shopifySchema = z.object({
  SHOPIFY_SHOP: z.string().min(1, "SHOPIFY_SHOP is required"),
  SHOPIFY_ADMIN_TOKEN: z.string().min(1, "SHOPIFY_ADMIN_TOKEN is required"),
  SHOPIFY_API_VERSION: z.string().min(1).default("2025-07"),
  CUTOVER_DATE: z.string().min(1, "CUTOVER_DATE is required"),
});

export interface DbConfig {
  databaseUrl: string;
  /**
   * Store id used ONLY by the offline inject path (which has no Shopify creds).
   * Real syncs ignore this and derive store_id from the live store's myshopifyDomain
   * via ensureStore(); if this disagrees with the API, ensureStore logs a warning.
   * Defaults to SHOPIFY_SHOP or "default".
   */
  storeId: string;
}

export interface ShopifyConfig {
  shop: string;
  adminToken: string;
  apiVersion: string;
  cutoverDate: string;
  /** GraphQL endpoint derived from shop + apiVersion. */
  endpoint: string;
}

export function loadDbConfig(env: NodeJS.ProcessEnv = process.env): DbConfig {
  const parsed = dbSchema.parse(env);
  return {
    databaseUrl: parsed.SHOPIFY_READ_DATABASE_URL,
    storeId: parsed.STORE_ID ?? env.SHOPIFY_SHOP ?? "default",
  };
}

export function loadShopifyConfig(env: NodeJS.ProcessEnv = process.env): ShopifyConfig {
  const parsed = shopifySchema.parse(env);
  const shop = parsed.SHOPIFY_SHOP;
  return {
    shop,
    adminToken: parsed.SHOPIFY_ADMIN_TOKEN,
    apiVersion: parsed.SHOPIFY_API_VERSION,
    cutoverDate: parsed.CUTOVER_DATE,
    endpoint: `https://${shop}/admin/api/${parsed.SHOPIFY_API_VERSION}/graphql.json`,
  };
}
