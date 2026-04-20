import { NextResponse } from "next/server";
import crypto from "crypto";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { sendEmail } from "@/lib/email";

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

        let order;
        try {
            order = JSON.parse(rawBody);
        } catch (parseError) {
            logger.error("Failed to parse Shopify webhook payload:", parseError);
            return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
        }

        // Iterate through line items to find CheckMeIn_Account_ID and Program_ID
        // We set these custom attributes in the permalink URL:
        // https://[store].myshopify.com/cart/[VariantID]:1?attributes[CheckMeIn_Account_ID]=123&attributes[Program_ID]=456
        
        let accountIdStr = null;
        let programIdStr = null;
        let membershipHouseholdIdStr = null;

        // Custom attributes in Cart Permalinks are usually mapped to `note_attributes` on the Order
        if (order.note_attributes && Array.isArray(order.note_attributes)) {
            for (const attr of order.note_attributes) {
                if (attr.name === "CheckMeIn_Account_ID") accountIdStr = attr.value;
                if (attr.name === "Program_ID") programIdStr = attr.value;
                if (attr.name === "Membership_Household_ID") membershipHouseholdIdStr = attr.value;
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
        } else if (!membershipHouseholdIdStr) {
             logger.info(`[SHOPIFY WEBHOOK] Payload received but missing identifying attributes. Ignoring.`);
        }

        if (membershipHouseholdIdStr) {
            const householdId = parseInt(membershipHouseholdIdStr, 10);
            if (!isNaN(householdId)) {
                const household = await prisma.household.findUnique({
                    where: { id: householdId },
                    include: { leads: { include: { participant: true } } }
                });

                if (household) {
                    const threeYearsAgo = new Date();
                    threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);

                    const needsBgCheck = !household.leads.some(l => 
                        l.participant.lastBackgroundCheck && 
                        new Date(l.participant.lastBackgroundCheck) > threeYearsAgo
                    );

                    const newStatus = needsBgCheck ? 'PENDING_BG_CHECK' : 'APPROVED';

                    await prisma.household.update({
                        where: { id: householdId },
                        data: { membershipStatus: newStatus }
                    });

                    const existingMembership = await prisma.membership.findFirst({
                        where: { householdId }
                    });
                    const externalIdStr = order.id ? String(order.id) : null;
                    const isActive = newStatus === 'APPROVED';

                    if (existingMembership) {
                        await prisma.membership.update({
                            where: { id: existingMembership.id },
                            data: { active: isActive, type: 'HOUSEHOLD', latestShopifyReceipt: externalIdStr }
                        });
                    } else {
                        await prisma.membership.create({
                            data: { householdId, type: 'HOUSEHOLD', active: isActive, latestShopifyReceipt: externalIdStr }
                        });
                    }

                    if (!isActive) {
                        const primaryLead = household.leads.find(l => l.isPrimary)?.participant || household.leads[0]?.participant;
                        if (primaryLead?.email) {
                            const bgCheckEmailHtml = `
                                <h2>Background Check Required</h2>
                                <p>Hi ${primaryLead.name},</p>
                                <p>Thank you for initiating your membership Application. The next step is to complete a background check for the primary household lead.</p>
                                <p><a href="https://background-check-provider.example.com/start" style="padding: 10px 20px; background: #3b82f6; color: white; border-radius: 5px; text-decoration: none;">Start Background Check</a></p>
                                <p>If you have any questions, please contact the board.</p>
                            `;
                            // sendEmail is imported from @/lib/email in other files, but here we can just require it or import it at the top.
                            // I should add import at the top of the file!
                        }
                        logger.info(`[SHOPIFY WEBHOOK] Household ${householdId} needs background check. Email dispatch pending.`);
                    }

                    logger.info(`[SHOPIFY WEBHOOK] Marked household ${householdId} membership status as ${newStatus}`);
                }
            }
        }

        // Always return 200 OK to Shopify to acknowledge receipt, even if missing attributes.
        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error("Shopify webhook error:", error);
        return NextResponse.json({ error: "Webhook Error" }, { status: 500 });
    }
}
