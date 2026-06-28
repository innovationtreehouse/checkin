import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { config } from "@/lib/config";
import { verifyZohoToken, parseZohoWebhook, ZOHO_WEBHOOK_HEADER } from "@/lib/membership/contract/zoho";
import { findProcessByEnvelope, markContractSigned } from "@/lib/membership/external";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/zoho — Zoho Sign contract completion callback.
 *
 * Verifies the shared-secret header, finds the membership process by its stored
 * Zoho request id, and (on a completed signing) records the contract as signed —
 * which may advance the application to PENDING_BG_REVIEW. We never read contract content.
 */
export async function POST(req: Request) {
    // Guard BEFORE the token verify so a flood can't burn CPU on signature checks.
    const limited = rateLimit(req, { name: "webhook-zoho", limit: 60, windowMs: 60_000 });
    if (limited) return limited;

    if (!config.zohoWebhookSecret()) {
        logger.error("Zoho webhook received but ZOHO_WEBHOOK_SECRET is not configured.");
        return NextResponse.json({ error: "Configuration Error" }, { status: 500 });
    }

    if (!verifyZohoToken(req.headers.get(ZOHO_WEBHOOK_HEADER))) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }

    const { requestId, completed } = parseZohoWebhook(body);
    if (!requestId) {
        logger.error("Zoho webhook missing request id.");
        return NextResponse.json({ error: "Missing request id" }, { status: 400 });
    }

    // Only act on completed signings; acknowledge other events so Zoho stops retrying.
    if (!completed) return NextResponse.json({ ok: true, ignored: "not completed" });

    const mp = await findProcessByEnvelope(requestId);
    if (!mp) {
        logger.error(`Zoho webhook: no membership process for request ${requestId}.`);
        // Acknowledge to avoid endless retries for an unknown request.
        return NextResponse.json({ ok: true, ignored: "unknown request" });
    }

    await markContractSigned(mp.id);
    return NextResponse.json({ ok: true });
}
