import { NextResponse } from "next/server";
import crypto from "crypto";
import { processPostEventEmails } from "@/lib/postEventEmails";

/**
 * Expected to be called by an external CRON trigger (e.g. Vercel Cron or CloudWatch Events)
 * GET /api/cron/post-event
 */
export async function GET(req: Request) {
    const authHeader = req.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret || !authHeader) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const expectedAuth = Buffer.from(`Bearer ${cronSecret}`);
    const actualAuth = Buffer.from(authHeader);

    if (actualAuth.length !== expectedAuth.length || !crypto.timingSafeEqual(actualAuth, expectedAuth)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        // By default, this uses the 1-hour delay rule
        const result = await processPostEventEmails({ forceImmediate: false });
        
        return NextResponse.json({ success: true, ...result });
    } catch (error) {
        console.error("Failed to run cron post-event:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
