import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cronAuth";
import { logger } from "@/lib/logger";
import { runExpirySweep } from "@/lib/trusted-adult/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/trusted-adult-expiry — warn families 30 days before an approved
 * trusted adult lapses, and expire links whose review date has passed.
 * Authorized by `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: Request) {
    const denied = requireCronSecret(req);
    if (denied) return denied;

    try {
        const result = await runExpirySweep(new Date());
        logger.info("[CRON] trusted-adult expiry sweep:", result);
        return NextResponse.json({ success: true, ...result });
    } catch (error) {
        logger.error("Trusted-adult expiry sweep error:", error);
        return NextResponse.json({ error: "Sweep failed" }, { status: 500 });
    }
}
