import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cronAuth";
import { logger } from "@/lib/logger";
import { runRenewalSweep } from "@/lib/membership/renewal";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/membership-renewals — open renewal processes for memberships due
 * within the lead window. Authorized by `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: Request) {
    const denied = requireCronSecret(req);
    if (denied) return denied;

    try {
        const result = await runRenewalSweep(new Date());
        logger.info("[CRON] membership renewal sweep:", result);
        return NextResponse.json({ success: true, ...result });
    } catch (error) {
        logger.error("Membership renewal sweep error:", error);
        return NextResponse.json({ error: "Sweep failed" }, { status: 500 });
    }
}
