import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/auth";
import { overrideBlocked, ReviewError } from "@/lib/membership/review";

export const dynamic = "force-dynamic";

/**
 * POST /api/membership-ops/applications/review-override — board action on a BLOCKED application.
 * Body: { processId, action: 'reset' | 'approve' }
 *   reset   — clear attestations, send back for re-review (re-ping reviewers)
 *   approve — board override: clear the check, activating if already paid else
 *             leaving it at PENDING_PAYMENT
 */
export const POST = withAuth({ roles: ["isSysadmin", "isBoardMember"] }, async (req, auth) => {
    if (auth.type !== "session") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    let body: { processId?: number; action?: "reset" | "approve" };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (!body.processId || (body.action !== "reset" && body.action !== "approve")) {
        return NextResponse.json({ error: "processId and action (reset|approve) are required" }, { status: 400 });
    }
    try {
        const outcome = await overrideBlocked(body.processId, auth.user.id, body.action);
        return NextResponse.json({ outcome });
    } catch (error) {
        if (error instanceof ReviewError) {
            return NextResponse.json({ error: error.message, code: error.code }, { status: error.code === "not_found" ? 404 : 409 });
        }
        logger.error("Review override error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
});
