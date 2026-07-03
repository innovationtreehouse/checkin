import { NextResponse } from "next/server";
import crypto from "crypto";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { config } from "@/lib/config";
import { logger } from "@/lib/logger";
import { apiError } from "@/lib/api-response";

export const dynamic = "force-dynamic";

/**
 * POST /api/dev/shopify/orders-paid — dev-only stand-in for a real Shopify
 * orders/paid webhook (see docs/designs/SHOPIFY_DEV_STORE_WEBHOOK.md §6). Reached
 * from the dev tool's "Fire orders/paid" button. Rather than shortcut to
 * activate(), it synthesizes the order payload Shopify would send for a paid
 * membership checkout, signs it with the mock webhook secret, and fires the REAL
 * inbound webhook — so it exercises the same HMAC-verify → match-by-cart-attribute
 * → activate() path prod runs (mirrors the Zoho mock, ZOHO_SIGN_DEV_MOCK.md §4a).
 *
 * 404s whenever the mock isn't active — always in prod. Also 404s a processId
 * that doesn't exist or isn't PENDING_PAYMENT: the dev UI only ever lists
 * PENDING_PAYMENT processes, so the API fails closed on anything else rather
 * than firing a webhook for a process that was never awaiting payment.
 */
export const POST = withAuth({}, async (req, auth) => {
    if (!config.shopifyMockActive()) return apiError("Not available", 404);
    if (auth.type !== "session") return apiError("Unauthorized", 401);

    // .catch covers unparseable bodies; ?. covers parseable non-objects (`null`, `42`).
    const body = await req.json().catch(() => null);
    const processId = body?.processId;
    if (typeof processId !== "number" || !Number.isInteger(processId)) {
        return apiError("Missing or invalid processId", 400);
    }

    const existing = await prisma.orgMembershipProcess.findUnique({ where: { id: processId }, select: { status: true } });
    if (!existing || existing.status !== "PENDING_PAYMENT") {
        return apiError("Process not found or not awaiting payment", 404);
    }

    const secret = config.shopifyWebhookSecret();
    if (!secret) return apiError("No webhook secret", 500);

    // A real paid order carries the membership variant id in its line_items; the
    // inbound handler matches it against BoardSettings to confirm the order is for
    // the membership product (#624/H2). The mock must echo a configured variant id
    // or the webhook lands as a no-membership-item anomaly, not an activation.
    const settings = await prisma.boardSettings.findUnique({ where: { id: 1 } });
    const variantId = settings?.orgMembershipVariantId ?? settings?.shopifyNormalVariantId ?? settings?.shopifyVolunteerVariantId;
    if (!variantId) {
        return apiError("No membership variant configured. Set one in Settings → Membership first (design §2, O4a).", 409);
    }

    // Shape mirrors the subset the inbound handler reads: note_attributes (where
    // Shopify maps cart attributes) + line_items + an order id. Stable id so two
    // overlapping fires for the same process (both inside the pre-check window
    // above) collapse into one idempotent webhook retry on the handler side;
    // sequential re-fires are blocked by the PENDING_PAYMENT gate.
    const payload = {
        id: `dev-mock-order-${processId}`,
        note_attributes: [{ name: "Membership_Process_ID", value: String(processId) }],
        line_items: [{ variant_id: variantId }],
    };
    const rawBody = JSON.stringify(payload);
    const signature = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");

    const res = await fetch(`${config.baseUrl()}/api/webhooks/shopify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-shopify-hmac-sha256": signature },
        body: rawBody,
    });
    if (!res.ok) {
        logger.error(`Dev shopify orders-paid: webhook returned ${res.status} for process ${processId}`);
        return NextResponse.json({ error: "Webhook failed", status: res.status }, { status: 502 });
    }

    // Report the resulting status so the tool can show whether it activated, held
    // for background clearance, etc. (the webhook itself always 200s to Shopify).
    const proc = await prisma.orgMembershipProcess.findUnique({ where: { id: processId }, select: { status: true } });
    return NextResponse.json({ ok: true, status: proc?.status ?? null });
});
