import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { markContractSigned, markBgConsent, setZohoEnvelope, ExternalError } from "@/lib/membership/external";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/membership/external — board controls for the EXTERNAL phase.
 *
 * Body: { processId, action, envelopeId? }
 *   action 'mark-contract'    — manually record the contract as signed (fallback to the Zoho webhook)
 *   action 'mark-bg-consent'  — human-mark that Averity consent was submitted
 *   action 'set-envelope'     — associate a Zoho signing request id (needs envelopeId)
 *
 * Any action that completes both external steps advances the application to PENDING_BG_REVIEW.
 */
export const POST = withAuth({ roles: ["sysadmin", "boardMember"] }, async (req, auth) => {
    if (auth.type !== "session") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const actorId = auth.user.id;

    let body: { processId?: number; action?: string; envelopeId?: string };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const { processId, action, envelopeId } = body;
    if (!processId || !action) {
        return NextResponse.json({ error: "processId and action are required" }, { status: 400 });
    }

    try {
        switch (action) {
            case "mark-contract":
                return NextResponse.json({ process: await markContractSigned(processId, actorId) });
            case "mark-bg-consent":
                return NextResponse.json({ process: await markBgConsent(processId, actorId) });
            case "set-envelope":
                if (!envelopeId) return NextResponse.json({ error: "envelopeId is required" }, { status: 400 });
                return NextResponse.json({ process: await setZohoEnvelope(processId, envelopeId, actorId) });
            default:
                return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
        }
    } catch (error) {
        if (error instanceof ExternalError) {
            return NextResponse.json({ error: error.message, code: error.code }, { status: error.code === "not_found" ? 404 : 400 });
        }
        console.error("Membership external action error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
});
