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
 * Note `shopify_read_<env>` lives on the SAME Aurora cluster as `checkin_<env>`
 * (isolated by database + role, not by cluster), so this pool is bound by the same
 * scale-to-zero invariant as lib/prisma.ts — see getPool below.
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
            // Scale-to-zero invariant (same rule as lib/prisma.ts, see PR #1030):
            // idle connections MUST be reaped and `min` MUST stay 0, or this pool
            // alone keeps the shared Aurora cluster from ever auto-pausing — it
            // pauses only after ~5 minutes with zero connections and zero queries.
            // Reaped fast (10s) rather than prisma.ts's 60s: that 60s buys warmth
            // across a USER's click-to-click gaps, and this pool has no user — it
            // serves one daily batch (api/cron/reconcile-shopify) and should let go
            // as soon as the run ends. No keepAlive: it exists to detect dead peers
            // on long-held connections, and nothing here holds one.
            idleTimeoutMillis: 10_000,
            min: 0,
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
    /**
     * The cart attributes we set on the checkout link (Membership_Process_ID,
     * CheckMeIn_Account_ID, Program_ID), mirrored since #1029. Null for orders
     * synced before that shipped — callers must handle absence.
     */
    noteAttributes: { key: string; value: string | null }[] | null;
}

const ORDER_COLS = `shopify_gid AS "orderGid", legacy_id AS "legacyId", customer_email AS "customerEmail",
    financial_status AS "financialStatus", total_cents AS "totalCents", subtotal_cents AS "subtotalCents",
    total_refunded_cents AS "totalRefundedCents", cancelled_at AS "cancelledAt", updated_at AS "updatedAt",
    note_attributes AS "noteAttributes"`;

/** Read one cart attribute off a mirrored order. Null when absent (or pre-#1029). */
export function orderAttr(o: MirrorOrder, key: string): string | null {
    return o.noteAttributes?.find((a) => a.key === key)?.value ?? null;
}

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
