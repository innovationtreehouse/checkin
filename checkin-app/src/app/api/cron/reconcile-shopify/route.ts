import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { withCron } from "@/lib/cronAuth";
import { runReconcile } from "@/lib/finance/reconcile";

/**
 * Hourly Shopify reconciler — runs ~15 min past the hour, right after each s-read
 * sync refreshes the `shopify_read` mirror. Recovers missed orders/paid webhooks
 * (advancing families past the paid checkpoint) and raises refund/chargeback/cancel
 * problems for the board. See lib/finance/reconcile.ts. No-op when the mirror isn't
 * wired (SHOPIFY_READ_DATABASE_URL unset).
 */
export const GET = withCron(async () => {
    const result = await runReconcile();
    logger.info(`[reconcile] ${JSON.stringify(result)}`);
    return NextResponse.json({ success: true, ...result });
});
