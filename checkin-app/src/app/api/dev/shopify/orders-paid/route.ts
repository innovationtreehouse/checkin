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
 * from the dev tool's "Fire orders/paid" buttons. Rather than shortcut to
 * activate(), it synthesizes the order payload Shopify would send, signs it with
 * the mock webhook secret, and fires the REAL inbound webhook — so it exercises
 * the same HMAC-verify → match-by-cart-attribute → activate path prod runs
 * (mirrors the Zoho mock, ZOHO_SIGN_DEV_MOCK.md §4a).
 *
 * Two payload shapes, discriminated by body:
 *   { processId }                     → membership activation
 *   { programId, participantIds[] }   → program-enrollment activation
 *
 * 404s whenever the mock isn't active — always in prod.
 */
export const POST = withAuth({}, async (req, auth) => {
    if (!config.shopifyMockActive()) return apiError("Not available", 404);
    if (auth.type !== "session") return apiError("Unauthorized", 401);

    const secret = config.shopifyWebhookSecret();
    if (!secret) return apiError("No webhook secret", 500);

    const body = await req.json().catch(() => ({}));

    if (typeof body.programId === "number") {
        return fireProgram(body);
    }
    if (typeof body.processId === "number") {
        return fireMembership(body.processId);
    }
    return apiError("Missing or invalid processId / programId", 400);
});

// Sign the mock payload with the fixed dev secret and POST it at the REAL inbound
// webhook, same as Shopify would. Returns the webhook's HTTP status.
async function fireWebhook(payload: unknown): Promise<number> {
    const secret = config.shopifyWebhookSecret()!;
    const rawBody = JSON.stringify(payload);
    const signature = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
    const res = await fetch(`${config.baseUrl()}/api/webhooks/shopify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-shopify-hmac-sha256": signature },
        body: rawBody,
    });
    return res.status;
}

async function fireMembership(processId: number): Promise<NextResponse> {
    if (!Number.isInteger(processId)) return apiError("Missing or invalid processId", 400);

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
    // Shopify maps cart attributes) + line_items + an order id. Stable id so a
    // re-fire is an idempotent webhook retry, exactly like Shopify's own retries.
    const status = await fireWebhook({
        id: `dev-mock-order-${processId}`,
        note_attributes: [{ name: "Membership_Process_ID", value: String(processId) }],
        line_items: [{ variant_id: variantId }],
    });
    if (status >= 400) {
        logger.error(`Dev shopify orders-paid: webhook returned ${status} for process ${processId}`);
        return NextResponse.json({ error: "Webhook failed", status }, { status: 502 });
    }

    // Report the resulting status so the tool can show whether it activated, held
    // for background clearance, etc. (the webhook itself always 200s to Shopify).
    const proc = await prisma.orgMembershipProcess.findUnique({ where: { id: processId }, select: { status: true } });
    return NextResponse.json({ ok: true, status: proc?.status ?? null });
}

async function fireProgram(body: { programId: number; participantIds?: unknown }): Promise<NextResponse> {
    const { programId } = body;
    const participantIds = Array.isArray(body.participantIds)
        ? body.participantIds.filter((n): n is number => typeof n === "number" && Number.isInteger(n))
        : [];
    if (!Number.isInteger(programId) || participantIds.length === 0) {
        return apiError("Missing or invalid programId / participantIds", 400);
    }

    // Mirror the membership variant echo: the program branch of the inbound
    // handler fails CLOSED unless the paid order's line_items contain one of the
    // program's own Shopify variant ids (route.ts:140). Program has a price (that's
    // how the participant reached PENDING) but the variant may still be unset.
    const program = await prisma.program.findUnique({
        where: { id: programId },
        select: { shopifyOrgMemberVariantId: true, shopifyNonOrgMemberVariantId: true },
    });
    if (!program) return apiError("Program not found", 404);
    const variantId = program.shopifyOrgMemberVariantId ?? program.shopifyNonOrgMemberVariantId;
    if (!variantId) {
        return apiError("No Shopify variant configured on this program. Set one on the program in program-ops first, or the webhook leaves the participant PENDING.", 409);
    }

    // note_attributes carry the comma-joined account ids + program id exactly as
    // buildShopifyCheckoutUrl encodes them; the handler splits on ',' and activates
    // each PENDING participant. Stable order id → idempotent re-fire.
    const status = await fireWebhook({
        id: `dev-mock-order-prog-${programId}`,
        note_attributes: [
            { name: "CheckMeIn_Account_ID", value: participantIds.join(",") },
            { name: "Program_ID", value: String(programId) },
        ],
        line_items: [{ variant_id: variantId }],
    });
    if (status >= 400) {
        logger.error(`Dev shopify orders-paid: webhook returned ${status} for program ${programId}`);
        return NextResponse.json({ error: "Webhook failed", status }, { status: 502 });
    }

    const activated = await prisma.programParticipant.findMany({
        where: { programId, personId: { in: participantIds } },
        select: { personId: true, status: true },
    });
    return NextResponse.json({ ok: true, participants: activated });
}
