import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { ApiResponseError, badRequest, handler } from "@/security/handler";

// Shopify Webhook for `orders/paid` or `orders/create`.
// HMAC signature verification is handled by the framework via
// `authorize: { webhook: 'shopify' }`; by the time this fn runs, the
// signature has been verified against the raw body using
// SHOPIFY_WEBHOOK_SECRET and `ctx.rawBody` is the verified payload.
export const POST = handler('POST /api/webhooks/shopify', async ({ rawBody }) => {
    try {
        let order;
        try {
            order = JSON.parse(rawBody!);
        } catch (parseError) {
            logger.error("Failed to parse Shopify webhook payload:", parseError);
            throw badRequest("Invalid JSON payload");
        }

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
        return { success: true };
    } catch (err) {
        if (err instanceof ApiResponseError) throw err;
        logger.error("Shopify webhook error:", err);
        throw err;
    }
});
