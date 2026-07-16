import { NextResponse } from "next/server";
import { withCron } from "@/lib/cronAuth";
import { logger } from "@/lib/logger";
import { runRenewalSweep } from "@/lib/membership/renewal";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/membership-renewals — open renewal processes for memberships due
 * within the lead window. Authorized by `Authorization: Bearer $CRON_SECRET`.
 */
export const GET = withCron(async () => {
    const result = await runRenewalSweep(new Date());
    logger.info("[CRON] membership renewal sweep:", result);
    return NextResponse.json({ success: true, ...result });
});
