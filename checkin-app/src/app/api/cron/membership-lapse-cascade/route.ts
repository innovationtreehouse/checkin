import { NextResponse } from "next/server";
import { withCron } from "@/lib/cronAuth";
import { logger } from "@/lib/logger";
import { runLapseCascadeSweep } from "@/lib/membership/lapse";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/membership-lapse-cascade — daily. Flags households whose org
 * membership has lapsed (revoked/denied, or a renewal overdue past the year
 * boundary), notifies them and the board once, and — once
 * BoardSettings.membershipLapseGraceDays has elapsed (NULL = auto-withdraw off) —
 * auto-withdraws their PENDING program enrollments via withdrawAndReleaseHold.
 * See docs/designs/MEMBERSHIP_LAPSE_CASCADE.md. Scheduling is an infra follow-up
 * (add alongside the other cron schedules). Authorized by
 * `Authorization: Bearer $CRON_SECRET` (see lib/cronAuth.ts).
 */
export const GET = withCron(async () => {
    const result = await runLapseCascadeSweep(new Date());
    logger.info("[CRON] membership-lapse cascade sweep:", result);
    return NextResponse.json({ success: true, ...result });
});
