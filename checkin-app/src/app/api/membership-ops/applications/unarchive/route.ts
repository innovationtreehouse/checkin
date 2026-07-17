import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/auth";
import { ReviewError } from "@/lib/membership/review";
import { unarchiveApplication } from "@/lib/membership/archive";
import { apiError } from "@/lib/api-response";

export const dynamic = "force-dynamic";

/**
 * POST /api/membership-ops/applications/unarchive — board recovery of a
 * wrongly-archived application. Body: { processId }. Restores it to the
 * in-flight status recorded in its archive audit row (409 wrong_phase if that
 * can't be determined, or if another in-flight process now occupies its slot).
 */
export const POST = withAuth({ roles: ["isSysadmin", "isBoardMember"] }, async (req, auth) => {
    if (auth.type !== "session") return apiError("Unauthorized", 401);
    let body: { processId?: number };
    try {
        body = await req.json();
    } catch {
        return apiError("Invalid JSON", 400);
    }
    if (!body.processId) return apiError("processId is required", 400);
    try {
        const outcome = await unarchiveApplication(body.processId, auth.user.id);
        return NextResponse.json({ outcome });
    } catch (error) {
        if (error instanceof ReviewError) {
            return NextResponse.json({ error: error.message, code: error.code }, { status: error.code === "not_found" ? 404 : 409 });
        }
        logger.error("Unarchive application error:", error);
        return apiError("Internal Server Error", 500);
    }
});
