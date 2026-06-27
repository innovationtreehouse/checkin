import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { syncContractStatus } from "@/lib/membership/external";

export const dynamic = "force-dynamic";

/**
 * POST /api/membership/contract/sync — applicant-facing "did my signature land?"
 * check, called when the signer returns from embedded signing (?signed=1). Pulls
 * the request status from Zoho and records it signed if complete, so the UI
 * reflects completion immediately instead of waiting on the (scale-to-zero-fragile)
 * Zoho webhook. Returns the current external status.
 */
export const POST = withAuth({}, async (_req, auth) => {
    if (auth.type !== "session") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const status = await syncContractStatus(auth.user.id);
        return NextResponse.json({ status });
    } catch (error) {
        logger.error(`Contract status sync error: ${error instanceof Error ? error.message : String(error)}`);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
});
