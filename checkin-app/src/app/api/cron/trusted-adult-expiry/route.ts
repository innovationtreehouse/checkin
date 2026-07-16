import { NextResponse } from "next/server";
import { withCron } from "@/lib/cronAuth";
import { logger } from "@/lib/logger";
import { runExpirySweep } from "@/lib/trusted-adult/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/trusted-adult-expiry — warn families 30 days before an approved
 * trusted adult lapses, and expire links whose review date has passed.
 * Authorized by `Authorization: Bearer $CRON_SECRET`.
 */
export const GET = withCron(async () => {
    const result = await runExpirySweep(new Date());
    logger.info("[CRON] trusted-adult expiry sweep:", result);
    return NextResponse.json({ success: true, ...result });
});
