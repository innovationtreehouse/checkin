import { NextResponse } from "next/server";
import { withCron } from "@/lib/cronAuth";
import { logger } from "@/lib/logger";
import { runStalenessNotifications } from "@/lib/staleness/registry";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/staleness-notifications — daily household-direct nudges as tracked
 * things (membership renewals, trusted adults, broken emails) approach and pass
 * their lapse date. Deduped by the NotificationLedger so overlapping/retried runs
 * don't re-send. Authorized by `Authorization: Bearer $CRON_SECRET`.
 * See docs/designs/STALENESS_NOTIFICATIONS.md.
 */
export const GET = withCron(async () => {
    const result = await runStalenessNotifications(new Date());
    logger.info("[CRON] staleness notifications:", result);
    return NextResponse.json({ success: true, ...result });
});
