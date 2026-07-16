import { Pool } from "pg";
import { config } from "@/lib/config";
import { logger } from "@/lib/logger";

/**
 * Read-only bridge to the s-read `shopify_read` Postgres — the mirror the
 * s-read-function keeps of Shopify orders/refunds/payouts/balance-transactions.
 * The reconciler (lib/finance/reconcile.ts) reads it to align Shopify order truth
 * with membership/program truth.
 *
 * Deliberately raw `pg` (parameterized SELECTs), NOT a second Prisma client: we
 * read a handful of columns from four tables, and a raw pool avoids wiring the
 * s-ingest-core generated client across the monorepo boundary (transpilePackages,
 * a second generate step, schema-version coupling). The mirror's own DDL owner
 * migrates it; we only ever read.
 *
 * The connection string SHOULD point at a read-only role. Null env → isConfigured()
 * is false and the reconciler no-ops, so an env without the mirror runs no
 * reconciliation rather than crashing.
 *
 * ponytail: no store_id filter — each env has its own `shopify_read_<env>` DB with
 * exactly one store, so filtering would only risk a myshopify-vs-storefront domain
 * mismatch. Add a store filter if a single mirror DB ever holds multiple stores.
 */

let pool: Pool | null = null;

function getPool(): Pool | null {
    const url = config.shopifyReadDatabaseUrl();
    if (!url) return null;
    if (!pool) {
        pool = new Pool({
            connectionString: url,
            max: 3,
            connectionTimeoutMillis: 10_000,
            keepAlive: true,
        });
        pool.on("error", (e) => logger.error("shopify_read pool error:", e));
    }
    return pool;
}

export function isConfigured(): boolean {
    return !!config.shopifyReadDatabaseUrl();
}

/** A row of `shop_order` — only the columns the reconciler needs. */
export interface MirrorOrder {
    /** Shopify order GID, e.g. gid://shopify/Order/123. */
    orderGid: string;
    /** Numeric order id — joins to OrgMembershipProcess/ProgramParticipant.shopifyOrderId. */
    legacyId: string | null;
    customerEmail: string | null;
    /** Shopify displayFinancialStatus, verbatim (uppercase): PAID, REFUNDED, … */
    financialStatus: string | null;
    totalCents: number;
    subtotalCents: number;
    totalRefundedCents: number;
    cancelledAt: Date | null;
    updatedAt: Date | null;
}

const ORDER_COLS = `shopify_gid AS "orderGid", legacy_id AS "legacyId", customer_email AS "customerEmail",
    financial_status AS "financialStatus", total_cents AS "totalCents", subtotal_cents AS "subtotalCents",
    total_refunded_cents AS "totalRefundedCents", cancelled_at AS "cancelledAt", updated_at AS "updatedAt"`;

/**
 * Orders whose mirror row changed after `since` (the reconciler's high-water mark),
 * excluding Shopify test orders. Oldest-first so the caller can advance the cursor
 * to the last row it processed. `since` null → from the beginning.
 */
export async function ordersChangedSince(since: Date | null, limit = 1000): Promise<MirrorOrder[]> {
    const p = getPool();
    if (!p) return [];
    const rows = await p.query<MirrorOrder>(
        `SELECT ${ORDER_COLS} FROM shop_order
         WHERE test = false AND ($1::timestamptz IS NULL OR updated_at > $1)
         ORDER BY updated_at ASC NULLS FIRST
         LIMIT $2`,
        [since, limit],
    );
    return rows.rows;
}

/** Look up specific orders by their numeric legacy id (the id the app stored on activation). */
export async function ordersByLegacyIds(legacyIds: string[]): Promise<MirrorOrder[]> {
    const p = getPool();
    if (!p || legacyIds.length === 0) return [];
    const rows = await p.query<MirrorOrder>(
        `SELECT ${ORDER_COLS} FROM shop_order WHERE legacy_id = ANY($1::text[])`,
        [legacyIds],
    );
    return rows.rows;
}

/**
 * Order GIDs that have a chargeback/dispute balance transaction, among the given
 * GIDs. Shopify Payments surfaces a dispute as a signed balance transaction whose
 * `type` names the dispute — this distinguishes a chargeback (CRITICAL) from an
 * ordinary refund. Case-insensitive LIKE so 'dispute'/'chargeback'/'adjustment'
 * variants all match.
 */
export async function disputedOrderGids(orderGids: string[]): Promise<Set<string>> {
    const p = getPool();
    if (!p || orderGids.length === 0) return new Set();
    const rows = await p.query<{ orderGid: string }>(
        `SELECT DISTINCT order_gid AS "orderGid" FROM shop_balance_transaction
         WHERE order_gid = ANY($1::text[])
           AND (lower(type) LIKE '%dispute%' OR lower(type) LIKE '%chargeback%')`,
        [orderGids],
    );
    return new Set(rows.rows.map((r) => r.orderGid));
}
