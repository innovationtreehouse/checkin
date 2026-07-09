/**
 * Shared plumbing for the Shopify LIVE contract suite (see
 * docs/designs/SHOPIFY_LIVE_TESTS.md). These tests run the app's REAL
 * lib/shopify.ts functions against the REAL dev store — no fetch mocks — to
 * catch Admin-API contract drift that mocked tests structurally cannot.
 *
 * Every suite must call ensureLiveStore() in beforeAll (dev-store-only guard)
 * and register created resources with track*() so afterAll + the janitor can
 * clean up even after a mid-test crash.
 */
import { assertLiveTestStore, CITEST_PREFIX } from "./guard";
import { getAccessToken, shopifyFetch, SHOPIFY_API_VERSION } from "@/lib/shopify";

export function ensureLiveStore(): string {
    return assertLiveTestStore(process.env);
}

/** Unique, janitor-recognizable name for this run's resources. */
export function testRunName(suite: string): string {
    return `${CITEST_PREFIX}${suite}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

async function authHeaders(): Promise<Record<string, string>> {
    const token = await getAccessToken();
    if (!token) throw new Error("shopify-live: could not mint an Admin API token — check dev credentials");
    return { "Content-Type": "application/json", "X-Shopify-Access-Token": token };
}

export function adminUrl(path: string): string {
    const domain = process.env.SHOPIFY_STORE_DOMAIN;
    return `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/${path}`;
}

/** GET an Admin resource, throwing on non-2xx with the body in the message. */
export async function adminGet<T>(path: string): Promise<T> {
    const res = await shopifyFetch(adminUrl(path), { headers: await authHeaders() }, `live GET ${path}`);
    if (!res.ok) throw new Error(`live GET ${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as T;
}

/** DELETE an Admin resource; 404 counts as already-gone (idempotent cleanup). */
export async function adminDelete(path: string): Promise<void> {
    const res = await shopifyFetch(adminUrl(path), { method: "DELETE", headers: await authHeaders() }, `live DELETE ${path}`);
    if (!res.ok && res.status !== 404) {
        throw new Error(`live DELETE ${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
}

// ── Cleanup registry: everything created gets registered the moment its id is
// known, so afterAll deletes it even when a later assertion throws. ──────────
const createdProductIds: string[] = [];
const createdPriceRuleIds: string[] = [];

export function trackProduct(id: string | number | null | undefined): void {
    if (id) createdProductIds.push(String(id));
}
export function trackPriceRule(id: string | number | null | undefined): void {
    if (id) createdPriceRuleIds.push(String(id));
}

export async function cleanupTracked(): Promise<void> {
    for (const id of createdPriceRuleIds.splice(0)) {
        await adminDelete(`price_rules/${id}.json`).catch((e) => console.error("cleanup price_rule", id, e));
    }
    for (const id of createdProductIds.splice(0)) {
        await adminDelete(`products/${id}.json`).catch((e) => console.error("cleanup product", id, e));
    }
}

// ── Typed slices of the Admin responses the assertions read. ────────────────
export interface AdminVariant {
    id: number;
    product_id: number;
    price: string;
    inventory_item_id: number;
    inventory_management: string | null;
    inventory_policy: string;
}

export async function getVariant(variantId: string): Promise<AdminVariant> {
    const data = await adminGet<{ variant: AdminVariant }>(`variants/${variantId}.json`);
    return data.variant;
}

export async function getAvailable(inventoryItemId: number): Promise<number> {
    const data = await adminGet<{ inventory_levels: { available: number }[] }>(
        `inventory_levels.json?inventory_item_ids=${inventoryItemId}`,
    );
    if (data.inventory_levels.length === 0) throw new Error("no inventory level rows for item");
    return data.inventory_levels.reduce((sum, l) => sum + (l.available ?? 0), 0);
}

export interface AdminPriceRule {
    id: number;
    title: string;
    value_type: string;
    value: string;
    allocation_method: string;
    target_type: string;
    target_selection: string;
    entitled_variant_ids: number[];
    usage_limit: number | null;
    once_per_customer: boolean;
    starts_at: string;
    ends_at: string | null;
}

/** Find the price rule mintMemberDiscountCode created — its title IS the code. */
export async function findPriceRuleByTitle(title: string): Promise<AdminPriceRule | null> {
    const data = await adminGet<{ price_rules: AdminPriceRule[] }>(`price_rules.json?limit=250`);
    return data.price_rules.find((r) => r.title === title) ?? null;
}
