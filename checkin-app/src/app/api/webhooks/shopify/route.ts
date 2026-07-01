import { NextResponse } from "next/server";
import crypto from "crypto";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { activateByProcessId } from "@/lib/membership/payment";
import { withWebhook } from "@/lib/webhookAuth";

interface ShopifyOrder {
    id?: number | string;
    note_attributes?: { name: string; value: string }[];
    // Decimal string in the shop's currency major units (e.g. "49.00" for $49.00),
    // per Shopify's order payload — NOT cents. Converted below to match the cents
    // BoardSettings.{normal,volunteer}DuesCents are stored in.
    total_price?: string;
}

/** order.total_price ("49.00") → cents. Unparseable/missing → 0 (fail closed: don't activate). */
function totalPriceCents(order: ShopifyOrder): number {
    const n = Number(order.total_price);
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/**
 * Verify the Shopify HMAC over the EXACT raw bytes. Config-not-set is a server
 * error (500); missing/wrong signature is unauthorized (401). Must run on the raw
 * body before it is parsed — re-serializing JSON would change the bytes.
 */
function verifyShopifyHmac(req: Request, rawBody: string): { ok: true } | { ok: false; status: number; error: string } {
    const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
    if (!secret) {
        logger.error("Shopify webhook received but SHOPIFY_WEBHOOK_SECRET is not configured.");
        return { ok: false, status: 500, error: "Configuration Error" };
    }

    const headerSignature = req.headers.get("x-shopify-hmac-sha256");
    if (!headerSignature) {
        return { ok: false, status: 401, error: "Missing signature" };
    }

    const generatedSignature = crypto
        .createHmac("sha256", secret)
        .update(rawBody, "utf8")
        .digest("base64");

    // Convert both signatures to Buffers to prevent timing attacks using crypto.timingSafeEqual.
    // Since HMAC-SHA256 in base64 is a known fixed length, an early length check does not leak
    // any secret information about the signature itself.
    const generatedBuffer = Buffer.from(generatedSignature);
    const headerBuffer = Buffer.from(headerSignature);

    if (generatedBuffer.length !== headerBuffer.length || !crypto.timingSafeEqual(generatedBuffer, headerBuffer)) {
        logger.error("Shopify webhook signature mismatch.");
        return { ok: false, status: 401, error: "Invalid signature" };
    }

    return { ok: true };
}

// Shopify Webhook for `orders/paid` or `orders/create`
// Verifies HMAC signature, extracts custom attributes, and marks user as ACTIVE
export const POST = withWebhook({ provider: "shopify", verify: verifyShopifyHmac }, async (_req, order: ShopifyOrder) => {
        // Iterate through line items to find CheckMeIn_Account_ID and Program_ID
        // We set these custom attributes in the permalink URL:
        // https://[store].myshopify.com/cart/[VariantID]:1?attributes[CheckMeIn_Account_ID]=123&attributes[Program_ID]=456
        
        let accountIdStr = null;
        let programIdStr = null;
        let membershipProcessIdStr = null;

        // Custom attributes in Cart Permalinks are usually mapped to `note_attributes` on the Order
        if (order.note_attributes && Array.isArray(order.note_attributes)) {
            for (const attr of order.note_attributes) {
                if (attr.name === "CheckMeIn_Account_ID") accountIdStr = attr.value;
                if (attr.name === "Program_ID") programIdStr = attr.value;
                if (attr.name === "Membership_Process_ID") membershipProcessIdStr = attr.value;
            }
        }

        // Membership payment → activate the household membership.
        //
        // H2 (fixed): activateByProcessId now checks order.total_price against the
        // expected dues for that process's household/tier (computeDuesCents in
        // payment.ts) and refuses to activate an underpaid order — see the H2 note
        // on activate() in payment.ts for how that's kept safe/idempotent.
        //
        // TODO(#278) still open: we still trust the customer-controlled
        // Membership_Process_ID cart attribute for WHICH process to credit (no
        // per-process checkout token yet), and the volunteer discount code is still
        // a self-serve code on a public cart link rather than gated to a Shopify
        // customer segment. Neither enables over-activation on its own now that the
        // amount is checked, but both remain honor-system until a real token /
        // Shopify-side segment exists.
        if (membershipProcessIdStr) {
            const processId = parseInt(membershipProcessIdStr, 10);
            if (!isNaN(processId)) {
                const proc = await activateByProcessId(processId, order.id ? String(order.id) : "", totalPriceCents(order));
                if (proc?.status === "ACTIVE") {
                    logger.info(`[SHOPIFY WEBHOOK] Activated membership for process ${processId}`);
                } else if (proc?.status === "BLOCKED") {
                    logger.warn(`[SHOPIFY WEBHOOK] Payment recorded for BLOCKED process ${processId} — membership NOT activated; board notified for refund`);
                } else if (proc?.status === "PENDING_BG_CLEARANCE") {
                    logger.info(`[SHOPIFY WEBHOOK] Payment recorded for process ${processId}; awaiting background-check clearance`);
                } else {
                    logger.info(`[SHOPIFY WEBHOOK] Payment webhook for process ${processId} — no state change (already processed)`);
                }
            }
            return NextResponse.json({ success: true });
        }

        if (accountIdStr && programIdStr) {
            const participantIds = accountIdStr.split(',').map((id: string) => parseInt(id.trim(), 10)).filter((id: number) => !isNaN(id));
            const programId = parseInt(programIdStr, 10);

            if (participantIds.length > 0 && !isNaN(programId)) {
                for (const participantId of participantIds) {
                    // Find existing participant
                    const existing = await prisma.programParticipant.findUnique({
                        where: {
                            programId_participantId: { programId, participantId }
                        }
                    });

                    if (existing) {
                        await prisma.programParticipant.update({
                            where: {
                                programId_participantId: { programId, participantId }
                            },
                            data: {
                                status: 'ACTIVE',
                                pendingSince: null, // clear out the pending timer
                            }
                        });
                        
                        logger.info(`[SHOPIFY WEBHOOK] Marked participant ${participantId} as ACTIVE for program ${programId}`);
                    } else {
                        logger.warn(`[SHOPIFY WEBHOOK] Participant ${participantId} not found in Program ${programId}. Ignoring payment.`);
                    }
                }
            }
        } else {
             logger.info(`[SHOPIFY WEBHOOK] Payload received but missing CheckMeIn_Account_ID or Program_ID attributes. Ignoring.`);
        }

        // Always return 200 OK to Shopify to acknowledge receipt, even if missing attributes.
        return NextResponse.json({ success: true });
});
