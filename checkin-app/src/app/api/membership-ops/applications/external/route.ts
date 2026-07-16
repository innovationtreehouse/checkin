import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/auth";
import { markContractSigned, markBgConsent, setZohoEnvelope, ExternalError } from "@/lib/membership/external";
import { apiError } from "@/lib/api-response";

export const dynamic = "force-dynamic";

/**
 * POST /api/membership-ops/applications/external — board controls for the EXTERNAL phase.
 *
 * Body: { processId, action, envelopeId? }
 *   action 'mark-contract'    — manually record the contract as signed (fallback to the Zoho webhook)
 *   action 'mark-bg-consent'  — human-mark that Averity consent was submitted
 *   action 'set-envelope'     — associate a Zoho signing request id (needs envelopeId)
 *
 * Completing the contract + background-check consent advances the application to
 * PENDING_PAYMENT; the background check then reviews in parallel with payment.
 */
export const POST = withAuth({ roles: ["isSysadmin", "isBoardMember"] }, async (req, auth) => {
    if (auth.type !== "session") return apiError("Unauthorized", 401);
    const actorId = auth.user.id;

    let body: { processId?: number; action?: string; envelopeId?: string };
    try {
        body = await req.json();
    } catch {
        return apiError("Invalid JSON", 400);
    }

    const { processId, action, envelopeId } = body;
    if (!processId || !action) {
        return apiError("processId and action are required", 400);
    }

    try {
        switch (action) {
            case "mark-contract":
                return NextResponse.json({ process: await markContractSigned(processId, actorId) });
            case "mark-bg-consent":
                return NextResponse.json({ process: await markBgConsent(processId, actorId) });
            case "set-envelope":
                if (!envelopeId) return apiError("envelopeId is required", 400);
                return NextResponse.json({ process: await setZohoEnvelope(processId, envelopeId, actorId) });
            default:
                return apiError(`Unknown action: ${action}`, 400);
        }
    } catch (error) {
        if (error instanceof ExternalError) {
            return NextResponse.json({ error: error.message, code: error.code }, { status: error.code === "not_found" ? 404 : 400 });
        }
        logger.error("Membership external action error:", error);
        return apiError("Internal Server Error", 500);
    }
});
