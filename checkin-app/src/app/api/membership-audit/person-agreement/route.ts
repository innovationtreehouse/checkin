import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { openPersonAgreementForBoard, PersonAgreementError } from "@/lib/membership/personAgreementTriggers";

export const dynamic = "force-dynamic";

/**
 * POST /api/membership-audit/person-agreement — board/sysadmin opens an individual
 * membership agreement for one adult child (#1224). Body: { personId }.
 *
 * The escape hatch for people the nightly rule doesn't reach: not program-attached, or
 * over its age ceiling (the board can tell an adult child from a spouse; the automatic
 * rule can't). Still refuses a household lead — they sign the household agreement, and an
 * open PERSON_AGREEMENT on a lead would shadow it — and still refuses an unknown age.
 * Idempotent: an obligation already open for this cycle is returned as-is.
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
        const process = await openPersonAgreementForBoard(body.personId, auth.user.id);
        return NextResponse.json({ process });
    } catch (error) {
        if (error instanceof PersonAgreementError) return apiError(error.message, 409);
        logger.error("openPersonAgreementForBoard error:", error);
        return apiError("Internal Server Error", 500);
    }
});
