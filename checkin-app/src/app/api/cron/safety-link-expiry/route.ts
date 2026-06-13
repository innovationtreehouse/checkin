import { NextResponse } from "next/server";
import crypto from "crypto";
import { logger } from "@/lib/logger";
import { runExpirySweep } from "@/lib/safety-link/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/safety-link-expiry — warn families 30 days before an approved
 * safety link lapses, and expire links whose review date has passed.
 * Authorized by `Authorization: Bearer $CRON_SECRET`.
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
        const result = await runExpirySweep(new Date());
        logger.info("[CRON] safety-link expiry sweep:", result);
        return NextResponse.json({ success: true, ...result });
    } catch (error) {
        logger.error("Safety-link expiry sweep error:", error);
        return NextResponse.json({ error: "Sweep failed" }, { status: 500 });
    }
}
