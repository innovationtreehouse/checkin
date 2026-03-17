import { NextResponse } from "next/server";
import crypto from "crypto";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";

// Shopify Webhook for `orders/paid` or `orders/create`
// Verifies HMAC signature, extracts custom attributes, and marks user as ACTIVE
export async function POST(req: Request) {
    const secret = process.env.SHOPIFY_WEBHOOK_SECRET;

    if (!secret) {
        logger.error("Shopify webhook received but SHOPIFY_WEBHOOK_SECRET is not configured.");
        return NextResponse.json({ error: "Configuration Error" }, { status: 500 });
    }

    try {
        const rawBody = await req.text();
        const headerSignature = req.headers.get("x-shopify-hmac-sha256");

        if (!headerSignature) {
            return NextResponse.json({ error: "Missing signature" }, { status: 401 });
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
            return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
        }

        const order = JSON.parse(rawBody);

        // Iterate through line items to find CheckMeIn_Account_ID and Program_ID
        // We set these custom attributes in the permalink URL:
        // https://[store].myshopify.com/cart/[VariantID]:1?attributes[CheckMeIn_Account_ID]=123&attributes[Program_ID]=456
        
        let accountIdStr = null;
        let programIdStr = null;

        // Custom attributes in Cart Permalinks are usually mapped to `note_attributes` on the Order
        if (order.note_attributes && Array.isArray(order.note_attributes)) {
            for (const attr of order.note_attributes) {
                if (attr.name === "CheckMeIn_Account_ID") accountIdStr = attr.value;
                if (attr.name === "Program_ID") programIdStr = attr.value;
            }
        }

        if (accountIdStr && programIdStr) {
            const participantId = parseInt(accountIdStr, 10);
            const programId = parseInt(programIdStr, 10);

            if (!isNaN(participantId) && !isNaN(programId)) {
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
        } else {
             logger.info(`[SHOPIFY WEBHOOK] Payload received but missing CheckMeIn_Account_ID or Program_ID attributes. Ignoring.`);
        }

        // Always return 200 OK to Shopify to acknowledge receipt, even if missing attributes.
        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error("Shopify webhook error:", error);
        return NextResponse.json({ error: "Webhook Error" }, { status: 500 });
    }
}
