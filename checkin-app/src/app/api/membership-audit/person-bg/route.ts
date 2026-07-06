import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { submitPersonBgForReview, PersonBgSubmitError } from "@/lib/membership/personBgSubmit";

export const dynamic = "force-dynamic";

/**
 * POST /api/membership-audit/person-bg — board/sysadmin records that an external
 * background check exists for a program person and submits it for two-reviewer
 * approval (Phase 3, manual path). Body: { personId }.
 *
 * Opens the PERSON_BG obligation if one isn't already open and marks it
 * review-ready (bgConsentAt) so the reviewer queue surfaces it. Idempotent. The
 * subject may have no login, so this is board/lead-initiated, not subject-initiated.
 */
export const POST = withAuth({ roles: ["isSysadmin", "isBoardMember"] }, async (req, auth) => {
    if (auth.type !== "session") return apiError("Unauthorized", 401);
    let body: { personId?: number };
    try {
        body = await req.json();
    } catch {
        return apiError("Invalid JSON", 400);
    }
    if (!body.personId) return apiError("personId is required", 400);
    try {
        const process = await submitPersonBgForReview(body.personId, auth.user.id);
        return NextResponse.json({ process });
    } catch (error) {
        if (error instanceof PersonBgSubmitError) return apiError(error.message, 409);
        logger.error("submitPersonBgForReview error:", error);
        return apiError("Internal Server Error", 500);
    }
});
