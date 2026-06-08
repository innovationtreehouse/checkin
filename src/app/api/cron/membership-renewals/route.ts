import { NextResponse } from "next/server";
import crypto from "crypto";
import { logger } from "@/lib/logger";
import { runRenewalSweep } from "@/lib/membership/renewal";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/membership-renewals — open renewal processes for memberships due
 * within the lead window. Authorized by `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: Request) {
    const authHeader = req.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || !authHeader) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const expected = `Bearer ${cronSecret}`;
    const a = Buffer.from(authHeader);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const result = await runRenewalSweep(new Date());
        logger.info("[CRON] membership renewal sweep:", result);
        return NextResponse.json({ success: true, ...result });
    } catch (error) {
        logger.error("Membership renewal sweep error:", error);
        return NextResponse.json({ error: "Sweep failed" }, { status: 500 });
    }
}
