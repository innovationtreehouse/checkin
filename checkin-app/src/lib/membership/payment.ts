import prisma from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { logger } from "@/lib/logger";
import { notifyBoardPaidReject } from "@/lib/membership/boardAlerts";

/**
 * Payment phase (PENDING_PAYMENT -> ACTIVE).
 *
 * Every household pays through the same Shopify membership product (its
 * checkout permalink is set in BoardSettings). Volunteer households get the
 * board's discount code appended to that link so Shopify applies their discount
 * at checkout — our dues figures are only what applicants *see*. The membership
 * process id rides along as a cart attribute so the orders/paid webhook can
 * match the payment back to this application. Payment (orders/paid webhook) OR a
 * board "payment-plan certified" override both converge on activate(): one place
 * that flips the membership ACTIVE, records how, and sends one congrats email.
 */

const SYSTEM_ACTOR = 0;

export class PaymentError extends Error {
    constructor(public readonly code: "not_found" | "wrong_phase", message: string) {
        super(message);
        this.name = "PaymentError";
    }
}

/** Annual dues in cents for this membership tier (volunteer families pay the lower rate). */
export async function computeDuesCents(isVolunteer: boolean): Promise<number> {
    const settings = await prisma.boardSettings.findUnique({ where: { id: 1 } });
    return isVolunteer ? settings?.volunteerDuesCents ?? 0 : settings?.normalDuesCents ?? 0;
}

/**
 * Build the Shopify cart-permalink checkout link for a membership process. Both
 * tiers point at the same product variant; volunteers get `discount=<code>`
 * appended so Shopify applies their discount at checkout. The process id rides
 * along as a cart attribute (`attributes[Membership_Process_ID]`) so the
 * orders/paid webhook can match the payment back to this application.
 */
export function buildMembershipCheckoutUrl(
    storeDomain: string,
    variantId: string,
    processId: number,
    discountCode: string | null,
): string {
    const parts: string[] = [];
    if (discountCode) parts.push(`discount=${encodeURIComponent(discountCode)}`);
    parts.push(`attributes[Membership_Process_ID]=${processId}`);
    return `https://${storeDomain}/cart/${variantId}:1?${parts.join("&")}`;
}

/**
 * Resolve the dues amount and the Shopify checkout link for a process in
 * PENDING_PAYMENT. The link is built from SHOPIFY_STORE_DOMAIN +
 * BoardSettings.membershipVariantId, with the volunteer discount code appended
 * for volunteer households. If the store domain or variant isn't configured,
 * returns the amount with a null link.
 */
export async function ensurePaymentLink(processId: number): Promise<{ amountCents: number; checkoutUrl: string | null }> {
    const proc = await prisma.membershipProcess.findUnique({ where: { id: processId } });
    if (!proc) throw new PaymentError("not_found", "Application not found.");
    if (proc.status !== "PENDING_PAYMENT") throw new PaymentError("wrong_phase", "This application is not awaiting payment.");

    const membership = await prisma.membership.findUnique({ where: { id: proc.membershipId }, select: { isVolunteer: true } });
    if (!membership) throw new PaymentError("not_found", "Membership not found.");

    const settings = await prisma.boardSettings.findUnique({ where: { id: 1 } });
    const amountCents = membership.isVolunteer ? settings?.volunteerDuesCents ?? 0 : settings?.normalDuesCents ?? 0;

    const variantId = settings?.membershipVariantId;
    const storeDomain = process.env.SHOPIFY_STORE_DOMAIN;
    if (!variantId || !storeDomain) return { amountCents, checkoutUrl: null };

    // TODO(#278): the code is appended to a public cart link, so entitlement is
    // currently honor-system — nothing stops a non-volunteer from reusing it, and
    // the orders/paid webhook does not validate it (see
    // api/webhooks/shopify/route.ts). Long-term: gate the coupon to an
    // auto-managed Shopify customer segment of volunteer households so Shopify
    // enforces who can redeem it.
    const discountCode = membership.isVolunteer ? settings?.volunteerDiscountCode ?? null : null;
    return { amountCents, checkoutUrl: buildMembershipCheckoutUrl(storeDomain, variantId, processId, discountCode) };
}

/** Resolve the caller's household PENDING_PAYMENT process and ensure its payment link. */
export async function ensurePaymentLinkForUser(userId: number) {
    const user = await prisma.participant.findUnique({ where: { id: userId }, select: { householdId: true } });
    if (!user?.householdId) throw new PaymentError("not_found", "You are not in a household.");
    const process = await prisma.membershipProcess.findFirst({
        where: { membership: { householdId: user.householdId }, status: "PENDING_PAYMENT" },
        orderBy: { id: "desc" },
    });
    if (!process) throw new PaymentError("wrong_phase", "No application is awaiting payment.");
    return ensurePaymentLink(process.id);
}

/**
 * The single payment path. Records the payment (paidAt + how), then gates on the
 * background check: if it has already cleared (bgClearedAt set), flip the
 * membership ACTIVE and send one congrats email; otherwise hold the process at
 * PENDING_BG_CLEARANCE — paid, but membership stays INACTIVE until two reviewers
 * approve (review.ts › clearBackgroundCheck then flips ACTIVE).
 *
 * FOR UPDATE serializes against the review path's attest() transaction, which
 * takes the same row lock — so the payment/clearance race can't lose an update.
 * Idempotent: a no-op only once the payment is already recorded (Shopify retries
 * an orders/paid webhook routinely) or the membership is already active.
 *
 * BLOCKED is NOT a silent no-op: if the check was rejected before the payment
 * webhook landed, the money is already at Shopify. We record the payment (keeping
 * the application BLOCKED — never activate without a valid check) and alert the
 * board to refund, rather than dropping the payment on the floor.
 *
 * H2: for the Shopify path (opts.via === "payment"), an order that doesn't cover
 * the household's expected dues (computeDuesCents) is also NOT a silent no-op —
 * it stays PENDING_PAYMENT (no paidAt), the board is alerted the same way as a
 * paid-while-blocked mismatch, and a follow-up correct payment activates normally.
 */
export async function activate(
    processId: number,
    opts: { via: "payment" | "certified"; actorId?: number; shopifyOrderId?: string; paidAmountCents?: number },
) {
    const result = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "MembershipProcess" WHERE id = ${processId} FOR UPDATE`;
        const process = await tx.membershipProcess.findUnique({ where: { id: processId } });
        if (!process) throw new PaymentError("not_found", "Application not found.");
        // Already recorded this payment (webhook retry) or already active → nothing to do.
        if (process.paidAt || process.status === "ACTIVE") {
            return { kind: "noop" as const };
        }
        const membership = await tx.membership.findUnique({ where: { id: process.membershipId }, select: { householdId: true, isVolunteer: true } });
        if (!membership) throw new PaymentError("not_found", "Membership not found.");

        const now = new Date();
        const payMeta = {
            ...(opts.shopifyOrderId ? { shopifyOrderId: opts.shopifyOrderId } : {}),
            ...(opts.via === "certified" && opts.actorId ? { certifiedById: opts.actorId } : {}),
        };

        // Reject landed before the payment: record the payment but stay BLOCKED
        // (don't resurrect / don't bump stageEnteredAt) and flag for refund.
        if (process.status === "BLOCKED") {
            await tx.membershipProcess.update({ where: { id: processId }, data: { paidAt: now, ...payMeta } });
            await tx.auditLog.create({
                data: {
                    actorId: opts.actorId ?? SYSTEM_ACTOR,
                    action: "EDIT",
                    tableName: "MembershipProcess",
                    affectedEntityId: processId,
                    oldData: { status: "BLOCKED" },
                    newData: { status: "BLOCKED", via: opts.via, paid: true, refundNeeded: true },
                },
            });
            return { kind: "paid_while_blocked" as const };
        }

        // Only a process actually awaiting payment advances. A checkout link is
        // minted only at PENDING_PAYMENT, so a payment for any other status
        // (INTAKE/EXTERNAL/renewal-review) is anomalous — a forged/replayed
        // webhook (TODO #278) or a process that moved unexpectedly. Don't advance
        // it; surface it instead of corrupting state.
        if (process.status !== "PENDING_PAYMENT") {
            logger.warn(`[membership] activate() ignored payment for process ${processId} in status ${process.status} — no payment was due`);
            return { kind: "noop" as const };
        }

        // H2: a real Shopify order (opts.via === "payment") must actually cover the
        // dues for THIS household's tier before we activate anything. Expected dues
        // come from our own membership.isVolunteer flag, not from the order's
        // discount_codes — so if a non-volunteer appends the volunteer discount code
        // to the (public) checkout link, they still owe the non-volunteer rate and
        // this simply fails as underpayment. That sidesteps comparing
        // order.discount_codes[].code against BoardSettings.volunteerDiscountCode
        // (see TODO #278 in the webhook route) — simpler, and just as correct, since
        // the only thing that matters is whether enough money arrived for this
        // household's real tier. A board "certified" payment-plan override has no
        // Shopify order at all, so it's exempt (opts.via !== "payment"). Only runs
        // when paidAmountCents is actually supplied: activateByProcessId (the only
        // production caller of the "payment" path) always passes the order's real
        // total — parsed-but-zero included, which correctly fails closed below —
        // so this only skips for callers that never had an amount to check.
        if (opts.via === "payment" && opts.paidAmountCents !== undefined) {
            const expectedDuesCents = await computeDuesCents(membership.isVolunteer);
            const paidCents = opts.paidAmountCents;
            // expectedDuesCents <= 0 means dues aren't configured yet (BoardSettings dues
            // columns default to 0). Treat that as "unpriced", NOT "free": without this
            // guard the check degrades to `paidCents < 0` — always false — and ANY order
            // (even a $0/garbage total) would activate for free, reopening H2. Fail closed;
            // a genuinely free membership would be granted via the board certify path, not Shopify.
            if (expectedDuesCents <= 0 || paidCents < expectedDuesCents) {
                await tx.auditLog.create({
                    data: {
                        actorId: SYSTEM_ACTOR,
                        action: "EDIT",
                        tableName: "MembershipProcess",
                        affectedEntityId: processId,
                        oldData: { status: "PENDING_PAYMENT" },
                        newData: { status: "PENDING_PAYMENT", via: opts.via, underpaid: true, paidCents, expectedDuesCents, shopifyOrderId: opts.shopifyOrderId ?? null },
                    },
                });
                // Do NOT set paidAt: elsewhere (clearBackgroundCheck, overrideBlocked) a
                // truthy paidAt means "payment step satisfied, skip straight to/through
                // background clearance" — setting it here would let a later bg-check
                // clearance activate the membership without ever paying the shortfall.
                // Status stays PENDING_PAYMENT so a follow-up correct payment (new
                // Shopify order, new webhook) activates normally on its own.
                return { kind: "underpaid" as const };
            }
        }

        const activating = !!process.bgClearedAt;
        await tx.membershipProcess.update({
            where: { id: processId },
            data: { paidAt: now, stageEnteredAt: now, ...payMeta, status: activating ? "ACTIVE" : "PENDING_BG_CLEARANCE" },
        });
        if (activating) {
            await tx.membership.update({ where: { id: process.membershipId }, data: { status: "ACTIVE" } });
        }
        await tx.auditLog.create({
            data: {
                actorId: opts.actorId ?? SYSTEM_ACTOR,
                action: "EDIT",
                tableName: "MembershipProcess",
                affectedEntityId: processId,
                oldData: { status: process.status },
                newData: activating ? { status: "ACTIVE", via: opts.via } : { status: "PENDING_BG_CLEARANCE", via: opts.via, paid: true },
            },
        });
        return activating ? { kind: "active" as const, householdId: membership.householdId } : { kind: "held" as const };
    });

    // Side effects outside the transaction: a slow/failed send must not roll back
    // the write, and only the call that actually recorded the change emits one.
    if (result.kind === "active") await sendCongrats(result.householdId);
    if (result.kind === "paid_while_blocked" || result.kind === "underpaid") await notifyBoardPaidReject(processId);
    return prisma.membershipProcess.findUnique({ where: { id: processId } });
}

/** Board override: certify a payment plan and activate without a Shopify payment. */
export async function certifyPaymentPlan(processId: number, actorId: number) {
    // Unlike the webhook path, a board certify is a deliberate action — reject
    // (not silently no-op) when the process isn't actually awaiting payment, so
    // certifying an already-ACTIVE or still-in-review grant surfaces a 409
    // instead of a misleading success. activate()'s own conditional flip stays
    // idempotent for the webhook/self-serve callers.
    const process = await prisma.membershipProcess.findUnique({ where: { id: processId } });
    if (!process) throw new PaymentError("not_found", "Application not found.");
    if (process.status !== "PENDING_PAYMENT") throw new PaymentError("wrong_phase", "This application is not awaiting payment.");
    return activate(processId, { via: "certified", actorId });
}

/** Webhook path: activate the process tied to a paid Shopify draft order. */
export async function activateByProcessId(processId: number, shopifyOrderId: string, paidAmountCents: number) {
    return activate(processId, { via: "payment", shopifyOrderId, paidAmountCents });
}

/** Send the one "welcome — your membership is active" email to a household's leads. */
export async function sendCongrats(householdId: number) {
    try {
        const leads = await prisma.householdLead.findMany({
            where: { householdId },
            select: { participant: { select: { email: true, name: true } } },
        });
        const base = process.env.NEXTAUTH_URL ?? "";
        await Promise.all(
            leads
                .map((l) => l.participant?.email)
                .filter((e): e is string => !!e)
                .map((email) =>
                    sendEmail(
                        email,
                        "Welcome to the Treehouse — your membership is active!",
                        `<p>Congratulations! Your household membership is now active. Welcome to the Innovation Treehouse community.</p><p><a href="${base}">Visit your dashboard</a></p>`,
                    ).catch((e) => logger.error("Congrats email failed:", e)),
                ),
        );
    } catch (e) {
        logger.error("sendCongrats failed:", e);
    }
}
