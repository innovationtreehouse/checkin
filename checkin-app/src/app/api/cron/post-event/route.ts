import { NextResponse } from "next/server";
import { withCron } from "@/lib/cronAuth";
import { processPostEventEmails } from "@/lib/postEventEmails";

/**
 * Expected to be called by an external CRON trigger (e.g. Vercel Cron or CloudWatch Events)
 * GET /api/cron/post-event
 */
export const GET = withCron(async () => {
    // By default, this uses the 1-hour delay rule
    const result = await processPostEventEmails({ forceImmediate: false });

    return NextResponse.json({ success: true, ...result });
});
