import { NextResponse } from "next/server";
import { withCron } from "@/lib/cronAuth";
import { logger } from "@/lib/logger";
import { runPersonBgNudgeSweep } from "@/lib/membership/personBgNudge";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/person-bg-nudge — send escalating background-check nudges to the
 * households of 18+ program students with an open PERSON_BG obligation (deduped per
 * threshold). Kept separate from person-bg-annual so that job stays single-purpose
 * (opening obligations); schedule this daily. Authorized by `Authorization: Bearer $CRON_SECRET`.
 */
export const GET = withCron(async () => {
    const result = await runPersonBgNudgeSweep(new Date());
    logger.info("[CRON] person-bg nudge sweep:", result);
    return NextResponse.json({ success: true, ...result });
});
