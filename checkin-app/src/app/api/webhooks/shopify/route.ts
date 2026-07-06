import { NextResponse } from "next/server";
import crypto from "crypto";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { activateByProcessId } from "@/lib/membership/payment";
import { withWebhook } from "@/lib/webhookAuth";
import { config, DEV_MOCK_MEMBERSHIP_VARIANT_ID } from "@/lib/config";
import { adjustProgramInventory } from "@/lib/shopify";

interface ShopifyOrder {
    id?: number | string;
    note_attributes?: { name: string; value: string }[];
    line_items?: { variant_id?: number | string }[];
}

/**
 * Verify the Shopify HMAC over the EXACT raw bytes. Config-not-set is a server
 * error (500); missing/wrong signature is unauthorized (401). Must run on the raw
 * body before it is parsed — re-serializing JSON would change the bytes.
 */
function verifyShopifyHmac(req: Request, rawBody: string): { ok: true } | { ok: false; status: number; error: string } {
    const secret = config.shopifyWebhookSecret();
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
// Verifies HMAC signature, extracts custom attributes, and marks user as ACTIVE.
//
// ENV: this handler runs in ALL environments — dev/prod receive it from the real
// Shopify store; local receives it from the self-fired mock (/api/dev/shopify/orders-paid).
// The HMAC secret differs per env (config.shopifyWebhookSecret). The only env-branched
// logic is the synthetic dev-mock variant fallback, gated on config.shopifyMockActive()
// (⇔ CHECKIN_ENV=local) below.
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
        // H2 (fixed): activateByProcessId now checks that the order actually
        // CONTAINS the membership product (its Shopify variant id), not just that
        // it totals enough — a total-price check drifts if BoardSettings dues fall
        // out of sync with Shopify's real price, and an attacker could otherwise pay
        // for unrelated items (e.g. a workshop) that happen to add up to the same
        // amount. A variant id is stable and is the same id the checkout link is
        // built from (buildMembershipCheckoutUrl), so it can't silently drift the
        // way a price copy can. See the H2 note on activate() in payment.ts for how
        // that's kept safe/idempotent. Issue #625 tracks the systemic fix for
        // keeping BoardSettings dues/prices aligned with Shopify (which also covers
        // the volunteer-discount-eligibility gap below).
        //
        // TODO(#278) still open: we still trust the customer-controlled
        // Membership_Process_ID cart attribute for WHICH process to credit (no
        // per-process checkout token yet), and the volunteer discount code is still
        // a self-serve code on a public cart link rather than gated to a Shopify
        // customer segment. Neither enables over-activation on its own now that the
        // membership item is checked, but both remain honor-system until a real
        // token / Shopify-side segment exists.
        if (membershipProcessIdStr) {
            const processId = parseInt(membershipProcessIdStr, 10);
            if (!isNaN(processId)) {
                const settings = await prisma.boardSettings.findUnique({ where: { id: 1 } });
                const membershipVariantIds = new Set(
                    [
                        settings?.orgMembershipVariantId,
                        settings?.shopifyNormalVariantId,
                        settings?.shopifyVolunteerVariantId,
                        // Local mock's self-fired order carries this synthetic id (config).
                        config.shopifyMockActive() ? DEV_MOCK_MEMBERSHIP_VARIANT_ID : null,
                    ].filter((v): v is string => !!v),
                );
                const hasMembershipItem = (order.line_items ?? []).some((li) => membershipVariantIds.has(String(li.variant_id)));
                const proc = await activateByProcessId(processId, order.id ? String(order.id) : "", hasMembershipItem);
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
                // Guard mirrors the membership H2 fix above: note_attributes
                // (CheckMeIn_Account_ID / Program_ID) are entirely
                // customer-controlled — set from the public cart permalink —
                // so nothing in the payload itself proves the paid order was
                // for THIS program at THIS program's price. Without this, an
                // attacker could self-enroll (the authenticated enroll flow
                // creates a PENDING participant, no payment) then pay for the
                // cheapest item in the store with a forged
                // Program_ID/CheckMeIn_Account_ID attribute and activate (or
                // activate someone else's) enrollment. Checked by variant id —
                // stable, and the same id the enroll flow's checkout link is
                // built from — not order total. Fail CLOSED: no variant
                // configured on the Program, or
                // no line-item match, means we do NOT activate.
                // Single-pool model (product decision 2026-07-06): shopifyVariantId,
                // when set, is matched alongside the legacy pair during the
                // transition — old programs never get shopifyVariantId, new ones
                // never get the legacy pair, so this is additive, not a widening
                // of what any one program accepts.
                const program = await prisma.program.findUnique({ where: { id: programId } });
                const programVariantIds = new Set(
                    [program?.shopifyVariantId, program?.shopifyOrgMemberVariantId, program?.shopifyNonOrgMemberVariantId].filter(
                        (v): v is string => !!v,
                    ),
                );
                const hasProgramItem = (order.line_items ?? []).some((li) => programVariantIds.has(String(li.variant_id)));

                // Which tier Shopify actually sold — needed below to mirror inventory
                // onto the SIBLING pool. buildShopifyCheckoutUrl fixes ONE variant per
                // order (one household = one tier per checkout), so if hasProgramItem
                // matched and this is false, the non-member tier is the one purchased.
                const purchasedOrgMember = !!program?.shopifyOrgMemberVariantId &&
                    (order.line_items ?? []).some((li) => String(li.variant_id) === program.shopifyOrgMemberVariantId);

                let activatedCount = 0;
                let releasedHoldCount = 0;

                for (const participantId of participantIds) {
                    // Find existing participant
                    const existing = await prisma.programParticipant.findUnique({
                        where: {
                            programId_personId: { programId, personId: participantId }
                        }
                    });

                    if (existing) {
                        if (!hasProgramItem) {
                            logger.warn(`[SHOPIFY WEBHOOK] Paid order ${order.id ?? "?"} for participant ${participantId} / program ${programId} did not contain the program's Shopify variant${programVariantIds.size === 0 ? " (program has no variant configured)" : ""} — participant left PENDING, NOT activated.`);
                            continue;
                        }

                        await prisma.programParticipant.update({
                            where: {
                                programId_personId: { programId, personId: participantId }
                            },
                            data: {
                                status: 'ACTIVE',
                                pendingSince: null, // clear out the pending timer
                            }
                        });
                        activatedCount++;

                        logger.info(`[SHOPIFY WEBHOOK] Marked participant ${participantId} as ACTIVE for program ${programId}`);

                        // Hold-ledger (product decision 2026-07-06): NORMAL PAYMENT is
                        // one of the three release paths. A denied scholarship
                        // applicant who pays anyway still had inventoryHeldAt set
                        // from application time; this sale just made Shopify
                        // auto-decrement a SECOND unit for the same seat. Release the
                        // hold (+1) to compensate, guarded transactionally
                        // (inventoryHeldAt NOT NULL -> NULL) so a webhook retry can't
                        // release twice. Without this, every denied-then-paying
                        // applicant permanently leaks a seat of capacity.
                        if (existing.inventoryHeldAt) {
                            const release = await prisma.programParticipant.updateMany({
                                where: { programId, personId: participantId, inventoryHeldAt: { not: null } },
                                data: { inventoryHeldAt: null },
                            });
                            releasedHoldCount += release.count;
                        }
                    } else {
                        logger.warn(`[SHOPIFY WEBHOOK] Participant ${participantId} not found in Program ${programId}. Ignoring payment.`);
                    }
                }

                // Release path (b), continued: fire the compensating +1 for every
                // hold released above, in one call. Never allowed to fail the
                // webhook response — same non-fatal posture as the sibling-mirror
                // block below (Shopify retries the whole order on a non-2xx).
                if (releasedHoldCount > 0) {
                    const ok = await adjustProgramInventory(
                        {
                            shopifyVariantId: program?.shopifyVariantId ?? null,
                            shopifyOrgMemberVariantId: program?.shopifyOrgMemberVariantId ?? null,
                            shopifyNonOrgMemberVariantId: program?.shopifyNonOrgMemberVariantId ?? null,
                        },
                        releasedHoldCount,
                    );
                    if (!ok) {
                        logger.error(`[SHOPIFY WEBHOOK] Failed to release ${releasedHoldCount} scholarship inventory hold(s) for program ${programId} after payment — capacity may be out of sync.`);
                    }
                }

                // LEGACY-ONLY two-pool mirror (product decision 2026-07-06, single-
                // pool redesign): the org-member and non-org-member variants each
                // carry their OWN Shopify inventory pool, both seeded to
                // maxParticipants — so Shopify only auto-decrements the pool for the
                // tier actually purchased, and the sibling pool needs a compensating
                // mirror. Single-pool (shopifyVariantId) programs need NO mirror —
                // there's exactly one pool, and Shopify already auto-decremented it
                // on the sale. Deliberately AFTER activation is committed, and never
                // allowed to fail the webhook response — Shopify retries the whole
                // order on a non-2xx.
                if (activatedCount > 0 && !program?.shopifyVariantId) {
                    const siblingOnly = purchasedOrgMember
                        ? { shopifyOrgMemberVariantId: null, shopifyNonOrgMemberVariantId: program?.shopifyNonOrgMemberVariantId ?? null }
                        : { shopifyOrgMemberVariantId: program?.shopifyOrgMemberVariantId ?? null, shopifyNonOrgMemberVariantId: null };
                    const ok = await adjustProgramInventory(siblingOnly, -activatedCount);
                    if (!ok) {
                        logger.error(`[SHOPIFY WEBHOOK] Failed to mirror sibling-variant inventory for program ${programId} after activating ${activatedCount} participant(s) — pools may be out of sync.`);
                    }
                }
            }
        } else {
             logger.info(`[SHOPIFY WEBHOOK] Payload received but missing CheckMeIn_Account_ID or Program_ID attributes. Ignoring.`);
        }

        // Always return 200 OK to Shopify to acknowledge receipt, even if missing attributes.
        return NextResponse.json({ success: true });
});
