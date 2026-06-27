import prisma from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { logger } from "@/lib/logger";

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
 * The single activation path. Flips the membership ACTIVE, marks the process
 * ACTIVE + paid, records how (Shopify order id or certifying board member), and
 * sends one congratulations email. Idempotent: a no-op if already ACTIVE.
 */
export async function activate(
    processId: number,
    opts: { via: "payment" | "certified"; actorId?: number; shopifyOrderId?: string },
) {
    const process = await prisma.membershipProcess.findUnique({ where: { id: processId } });
    if (!process) throw new PaymentError("not_found", "Application not found.");
    const membership = await prisma.membership.findUnique({ where: { id: process.membershipId }, select: { householdId: true } });
    if (!membership) throw new PaymentError("not_found", "Membership not found.");

    const now = new Date();
    // The flip + membership update + audit row are one transaction, and the flip
    // is CONDITIONAL on status != ACTIVE. Under Read Committed, two concurrent
    // updateMany re-check the WHERE against the just-committed row, so exactly one
    // sees count === 1 and the rest see 0 — no row lock needed. Shopify retries
    // an orders/paid webhook routinely; this makes activate() truly idempotent
    // (no duplicate audit rows, no duplicate congrats emails).
    const flipped = await prisma.$transaction(async (tx) => {
        const { count } = await tx.membershipProcess.updateMany({
            where: { id: processId, status: { not: "ACTIVE" } },
            data: {
                status: "ACTIVE",
                stageEnteredAt: now,
                paidAt: now,
                ...(opts.shopifyOrderId ? { shopifyOrderId: opts.shopifyOrderId } : {}),
                ...(opts.via === "certified" && opts.actorId ? { certifiedById: opts.actorId } : {}),
            },
        });
        if (count === 0) return false; // already ACTIVE — a retry; skip audit + email

        await tx.membership.update({ where: { id: process.membershipId }, data: { status: "ACTIVE" } });
        await tx.auditLog.create({
            data: {
                actorId: opts.actorId ?? SYSTEM_ACTOR,
                action: "EDIT",
                tableName: "MembershipProcess",
                affectedEntityId: processId,
                oldData: JSON.stringify({ status: process.status }),
                newData: JSON.stringify({ status: "ACTIVE", via: opts.via }),
            },
        });
        return true;
    });

    // Email outside the transaction: a slow/failed send must not roll back the
    // activation, and we only send when this call is the one that flipped it.
    if (flipped) await sendCongrats(membership.householdId);
    return prisma.membershipProcess.findUnique({ where: { id: processId } });
}

/** Board override: certify a payment plan and activate without a Shopify payment. */
export async function certifyPaymentPlan(processId: number, actorId: number) {
    return activate(processId, { via: "certified", actorId });
}

/** Webhook path: activate the process tied to a paid Shopify draft order. */
export async function activateByProcessId(processId: number, shopifyOrderId: string) {
    return activate(processId, { via: "payment", shopifyOrderId });
}

async function sendCongrats(householdId: number) {
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
