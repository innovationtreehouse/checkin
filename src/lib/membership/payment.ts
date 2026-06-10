import prisma from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { logger } from "@/lib/logger";
import { createMembershipDraftOrder } from "@/lib/shopify";

/**
 * Payment phase (PENDING_PAYMENT -> ACTIVE).
 *
 * Our system is the source of truth for dues (volunteer vs normal, from
 * BoardSettings). We create a per-household Shopify draft order at that price and
 * hand back its unique invoice URL. Payment (orders/paid webhook) OR a board
 * "payment-plan certified" override both converge on activate(): one place that
 * flips the membership ACTIVE, records how, and sends one congrats email.
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
 * Ensure a payment link exists for a process in PENDING_PAYMENT, creating the
 * Shopify draft order on first call. Idempotent: returns the stored link after.
 * If Shopify isn't configured, returns the amount with a null link.
 */
export async function ensurePaymentLink(processId: number): Promise<{ amountCents: number; invoiceUrl: string | null }> {
    const process = await prisma.membershipProcess.findUnique({ where: { id: processId } });
    if (!process) throw new PaymentError("not_found", "Application not found.");
    if (process.status !== "PENDING_PAYMENT") throw new PaymentError("wrong_phase", "This application is not awaiting payment.");

    const membership = await prisma.membership.findUnique({ where: { id: process.membershipId }, select: { isVolunteer: true } });
    if (!membership) throw new PaymentError("not_found", "Membership not found.");
    const amountCents = await computeDuesCents(membership.isVolunteer);
    if (process.shopifyInvoiceUrl) return { amountCents, invoiceUrl: process.shopifyInvoiceUrl };

    const draft = await createMembershipDraftOrder({ processId, amountCents, isVolunteer: membership.isVolunteer });
    if (!draft) return { amountCents, invoiceUrl: null };

    await prisma.membershipProcess.update({
        where: { id: processId },
        data: { shopifyDraftOrderId: draft.draftOrderId, shopifyInvoiceUrl: draft.invoiceUrl },
    });
    return { amountCents, invoiceUrl: draft.invoiceUrl };
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
    const membership = await prisma.membership.findUnique({ where: { id: process.membershipId }, select: { status: true, householdId: true } });
    if (!membership) throw new PaymentError("not_found", "Membership not found.");
    if (process.status === "ACTIVE" && membership.status === "ACTIVE") return process;

    const now = new Date();
    const updated = await prisma.membershipProcess.update({
        where: { id: processId },
        data: {
            status: "ACTIVE",
            stageEnteredAt: now,
            paidAt: now,
            ...(opts.shopifyOrderId ? { shopifyOrderId: opts.shopifyOrderId } : {}),
            ...(opts.via === "certified" && opts.actorId ? { certifiedById: opts.actorId } : {}),
        },
    });
    await prisma.membership.update({ where: { id: process.membershipId }, data: { status: "ACTIVE" } });

    await prisma.auditLog.create({
        data: {
            actorId: opts.actorId ?? SYSTEM_ACTOR,
            action: "EDIT",
            tableName: "MembershipProcess",
            affectedEntityId: processId,
            oldData: JSON.stringify({ status: process.status }),
            newData: JSON.stringify({ status: "ACTIVE", via: opts.via }),
        },
    });

    await sendCongrats(membership.householdId);
    return updated;
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
