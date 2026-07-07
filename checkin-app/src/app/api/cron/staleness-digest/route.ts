import { NextResponse } from "next/server";
import { withCron } from "@/lib/cronAuth";
import { logger } from "@/lib/logger";
import { sendStalenessDigest } from "@/lib/staleness/registry";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/staleness-digest — weekly digest to the board/ops admin list of
 * everything currently stale (membership renewals, trusted adults, broken emails),
 * grouped by type. No ledger; periodic by construction. Authorized by
 * `Authorization: Bearer $CRON_SECRET`. See docs/designs/STALENESS_NOTIFICATIONS.md.
 */
export const GET = withCron(async () => {
    const result = await sendStalenessDigest(new Date());
    logger.info("[CRON] staleness digest:", result);
    return NextResponse.json({ success: true, ...result });
});
