import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { activateByProcessId } from "@/lib/membership/payment";
import { notifyBoardPaymentException } from "@/lib/membership/boardAlerts";
import * as mirror from "@/lib/shopifyRead/client";
import type { MirrorOrder } from "@/lib/shopifyRead/client";

/**
 * Shopify payment reconciler. Reads the s-read `shopify_read` mirror and aligns
 * Shopify order truth with membership/program truth, both directions:
 *
 *   forward  — a paid order whose family is still stuck at PENDING_PAYMENT is a
 *              MISSED orders/paid webhook: recover it (activate), advancing the
 *              family past the paid checkpoint. Application AND renewal.
 *   reversal — an order we already activated on that is later refunded, charged
 *              back, or cancelled: raise a PaymentException for the board. We never
 *              auto-revert access (a chargeback can be a bank error).
 *
 * Runs hourly from api/cron/reconcile-shopify. Idempotent: forward recovery is a
 * no-op once activate() has recorded the order (activate stores shopifyOrderId and
 * short-circuits on paidAt), and every exception upserts on (kind, order).
 *
 * Matching key is the order's customer EMAIL → household lead → the family's single
 * PENDING_PAYMENT process (the mirror carries no cart note-attributes and no line
 * variant id, so we cannot use the webhook's exact process-id / variant match). A
 * zero/ambiguous email match, or an amount that does not cover dues, raises a
 * problem instead of guessing.
 */

export type PaymentExceptionKind =
    | "PAID_WHILE_BLOCKED"
    | "NO_ITEM"
    | "UNMATCHED_ORDER"
    | "REFUND"
    | "CHARGEBACK"
    | "CANCELLED"
    | "REVERSED_BEFORE_ACTIVATION"
    | "AMOUNT_MISMATCH"
    | "ACTIVE_WITHOUT_PAYMENT";

type Severity = "WARN" | "CRITICAL";

const CRITICAL_KINDS = new Set<PaymentExceptionKind>(["CHARGEBACK"]);

// A recovered payment may come in a cent or two under the recorded dues (rounding,
// a stale settings copy). Only a shortfall beyond this is a real mismatch.
const AMOUNT_TOLERANCE_CENTS = 100;

interface ExceptionRef {
    shopifyOrderId?: string | null;
    processId?: number | null;
    programId?: number | null;
    personId?: number | null;
    severity?: Severity;
}

/**
 * Upsert a PaymentException, idempotent across hourly runs. One open row per
 * (kind, order); a resolved row that re-detects reopens (the problem came back). A
 * newly-opened or reopened row escalates to the board (CRITICAL emails immediately;
 * WARN is surfaced on the dashboard + red-dot only — see notifyBoardPaymentException).
 */
export async function raisePaymentException(kind: PaymentExceptionKind, ref: ExceptionRef): Promise<void> {
    const severity: Severity = ref.severity ?? (CRITICAL_KINDS.has(kind) ? "CRITICAL" : "WARN");
    const orderId = ref.shopifyOrderId ?? null;

    // Find an existing row for this (kind, order). When orderId is null the unique
    // index treats rows as distinct, so fall back to the linked entity.
    const existing = orderId
        ? await prisma.paymentException.findFirst({ where: { kind, shopifyOrderId: orderId } })
        : await prisma.paymentException.findFirst({
              where: { kind, shopifyOrderId: null, processId: ref.processId ?? null, programId: ref.programId ?? null, personId: ref.personId ?? null },
          });

    if (existing) {
        if (existing.status === "RESOLVED") {
            await prisma.paymentException.update({
                where: { id: existing.id },
                data: { status: "OPEN", severity, resolvedAt: null, resolvedById: null, resolutionNote: null, detectedAt: new Date() },
            });
            await notifyBoardPaymentException(kind, severity, existing.id);
        }
        return; // already tracked and still open/acknowledged — nothing to do.
    }

    try {
        const created = await prisma.paymentException.create({
            data: {
                kind,
                severity,
                shopifyOrderId: orderId,
                processId: ref.processId ?? null,
                programId: ref.programId ?? null,
                personId: ref.personId ?? null,
            },
        });
        await notifyBoardPaymentException(kind, severity, created.id);
    } catch (e: unknown) {
        // Unique-index race (two runs, same order) — the other run created it. Safe.
        if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "P2002") return;
        throw e;
    }
}

// ── predicates over a mirror order ───────────────────────────────────────────

/** Shopify displayFinancialStatus that means "money is in" and not reversed. */
function isPaid(o: MirrorOrder): boolean {
    const s = (o.financialStatus ?? "").toUpperCase();
    return (s === "PAID" || s === "PARTIALLY_PAID") && !o.cancelledAt && o.totalRefundedCents === 0;
}

/** Any sign the money came back out. */
function isReversed(o: MirrorOrder): boolean {
    const s = (o.financialStatus ?? "").toUpperCase();
    return !!o.cancelledAt || o.totalRefundedCents > 0 || s === "REFUNDED" || s === "PARTIALLY_REFUNDED" || s === "VOIDED";
}

// ── forward pass (recover missed payments) ───────────────────────────────────

/**
 * Try to attribute one mirror order to a membership process by customer email and
 * act on it. Returns true if the order was claimed (recovered or raised), false if
 * it is not a membership order (so a program pass may still claim it).
 */
async function reconcileForwardMembership(order: MirrorOrder): Promise<boolean> {
    const email = order.customerEmail?.toLowerCase().trim();
    if (!email) return false;

    // Already recorded on a process? Then it is not a missed payment.
    if (order.legacyId) {
        const known = await prisma.orgMembershipProcess.findFirst({ where: { shopifyOrderId: order.legacyId }, select: { id: true } });
        if (known) return true;
    }

    const leads = await prisma.person.findMany({ where: { email, isHouseholdLead: true }, select: { householdId: true } });
    const householdIds = [...new Set(leads.map((l) => l.householdId))];
    if (householdIds.length === 0) return false;

    const pending = await prisma.orgMembershipProcess.findMany({
        where: { orgMembership: { householdId: { in: householdIds } }, status: "PENDING_PAYMENT" },
        select: { id: true, orgMembershipId: true },
    });
    if (pending.length === 0) return false; // family has no membership awaiting payment.

    if (pending.length > 1) {
        // Can't safely pick which pending membership this order paid for.
        await raisePaymentException("UNMATCHED_ORDER", { shopifyOrderId: order.legacyId });
        return true;
    }

    const proc = pending[0];

    // Paid then reversed before we ever activated — keep it PENDING, tell the board.
    if (isReversed(order)) {
        await raisePaymentException("REVERSED_BEFORE_ACTIVATION", { shopifyOrderId: order.legacyId, processId: proc.id });
        return true;
    }
    if (!isPaid(order)) return true; // pending/authorized/etc — nothing to do yet, but it IS this family's order.

    // Amount gate: the mirror has no line variant id, so we cannot replicate the
    // webhook's variant-id membership-item check — gate on the order covering dues
    // instead (matched to THIS pending process). Short → mismatch, not activation.
    const membership = proc.orgMembershipId
        ? await prisma.orgMembership.findUnique({ where: { id: proc.orgMembershipId }, select: { isVolunteer: true } })
        : null;
    const settings = await prisma.boardSettings.findUnique({ where: { id: 1 }, select: { normalDuesCents: true, volunteerDuesCents: true } });
    const expected = membership?.isVolunteer ? settings?.volunteerDuesCents ?? 0 : settings?.normalDuesCents ?? 0;
    if (expected > 0 && order.totalCents + AMOUNT_TOLERANCE_CENTS < expected) {
        await raisePaymentException("AMOUNT_MISMATCH", { shopifyOrderId: order.legacyId, processId: proc.id });
        return true;
    }

    // Recover: advance past the paid checkpoint. hasMembershipItem=true — matched to
    // this specific pending process and the amount covers dues (honest missed-webhook
    // assumption; the reconciler is not the attack surface the public webhook is, and
    // it leaves a full AuditLog trail via activate()).
    const result = await activateByProcessId(proc.id, order.legacyId ?? "", true);
    logger.info(`[reconcile] recovered missed payment: process ${proc.id} ← order ${order.legacyId} (${result?.status})`);
    if (result?.status === "BLOCKED") {
        await raisePaymentException("PAID_WHILE_BLOCKED", { shopifyOrderId: order.legacyId, processId: proc.id });
    }
    return true;
}

/**
 * Program forward recovery: a paid order matched by email to persons who have a
 * PENDING enrollment. Uses the shared activateProgramEnrollment (extracted from the
 * webhook). Returns true if claimed.
 */
async function reconcileForwardProgram(order: MirrorOrder): Promise<boolean> {
    const email = order.customerEmail?.toLowerCase().trim();
    if (!email) return false;
    if (!isPaid(order)) return false;

    if (order.legacyId) {
        const known = await prisma.programParticipant.findFirst({ where: { shopifyOrderId: order.legacyId }, select: { programId: true } });
        if (known) return true;
    }

    // The purchaser (household lead) and everyone in their household — enrollment is
    // per person, but the order pays under the lead's email.
    const leads = await prisma.person.findMany({ where: { email, isHouseholdLead: true }, select: { householdId: true } });
    const householdIds = [...new Set(leads.map((l) => l.householdId))];
    if (householdIds.length === 0) return false;
    const people = await prisma.person.findMany({ where: { householdId: { in: householdIds } }, select: { id: true } });
    const personIds = people.map((p) => p.id);

    const pending = await prisma.programParticipant.findMany({
        where: { personId: { in: personIds }, status: "PENDING" },
        select: { programId: true, personId: true },
    });
    if (pending.length === 0) return false;

    // A single order can enroll a whole household in one program; more than one
    // distinct program among the pending set is unattributable from the mirror.
    const programs = [...new Set(pending.map((p) => p.programId))];
    if (programs.length > 1) {
        await raisePaymentException("UNMATCHED_ORDER", { shopifyOrderId: order.legacyId });
        return true;
    }

    const { activateProgramEnrollment } = await import("@/lib/programs/activateEnrollment");
    const res = await activateProgramEnrollment({
        programId: programs[0],
        personIds: pending.map((p) => p.personId),
        shopifyOrderId: order.legacyId ?? "",
        // No line variant id in the mirror — trust the email+pending match for the
        // recovery path (see the membership amount-gate note). Tier unknown → no
        // legacy sibling-inventory mirror.
        hasProgramItem: true,
        purchasedOrgMember: null,
    });
    logger.info(`[reconcile] recovered program payment: program ${programs[0]} ← order ${order.legacyId} (${res.activatedCount} activated)`);
    return true;
}

// ── reversal pass (raise problems on money that came back out) ────────────────

function classifyReversal(o: MirrorOrder, disputed: boolean): PaymentExceptionKind | null {
    if (o.cancelledAt) return "CANCELLED";
    if (disputed) return "CHARGEBACK";
    if (isReversed(o)) return "REFUND";
    return null;
}

/**
 * Fast-path entry for the reversal webhooks (refunds/create, orders/cancelled,
 * disputes/*): map a Shopify order id to the membership process and/or program
 * enrollment it activated and raise the given problem. Returns true if anything
 * matched. Shares the same idempotent raise as the hourly reconciler.
 */
export async function raiseReversalByOrderId(orderLegacyId: string, kind: PaymentExceptionKind): Promise<boolean> {
    let matched = false;
    const proc = await prisma.orgMembershipProcess.findFirst({ where: { shopifyOrderId: orderLegacyId }, select: { id: true } });
    if (proc) {
        await raisePaymentException(kind, { shopifyOrderId: orderLegacyId, processId: proc.id });
        matched = true;
    }
    const enrolls = await prisma.programParticipant.findMany({ where: { shopifyOrderId: orderLegacyId }, select: { programId: true, personId: true } });
    for (const e of enrolls) {
        await raisePaymentException(kind, { shopifyOrderId: orderLegacyId, programId: e.programId, personId: e.personId });
        matched = true;
    }
    return matched;
}

async function reconcileReversals(): Promise<number> {
    // App-side activated orders: money recorded (paidAt) with an order id. BLOCKED
    // stays out — a refund on a paid-while-blocked application is the expected fix.
    const procs = await prisma.orgMembershipProcess.findMany({
        where: { shopifyOrderId: { not: null }, paidAt: { not: null }, status: { in: ["ACTIVE", "PENDING_BG_CLEARANCE"] } },
        select: { id: true, shopifyOrderId: true, orgMembershipId: true },
    });
    const enrolls = await prisma.programParticipant.findMany({
        where: { shopifyOrderId: { not: null }, status: "ACTIVE" },
        select: { programId: true, personId: true, shopifyOrderId: true },
    });

    const orderIds = [
        ...procs.map((p) => p.shopifyOrderId!),
        ...enrolls.map((e) => e.shopifyOrderId!),
    ];
    if (orderIds.length === 0) return 0;

    const orders = await mirror.ordersByLegacyIds([...new Set(orderIds)]);
    const byLegacy = new Map(orders.map((o) => [o.legacyId ?? "", o]));
    const disputed = await mirror.disputedOrderGids(orders.map((o) => o.orderGid));

    // Expected dues per membership (for the "order edited down below dues" case).
    const settings = await prisma.boardSettings.findUnique({ where: { id: 1 }, select: { normalDuesCents: true, volunteerDuesCents: true } });
    const memberIds = procs.map((p) => p.orgMembershipId).filter((v): v is number => v != null);
    const members = memberIds.length
        ? await prisma.orgMembership.findMany({ where: { id: { in: memberIds } }, select: { id: true, isVolunteer: true } })
        : [];
    const isVolunteerById = new Map(members.map((m) => [m.id, m.isVolunteer]));

    let raised = 0;
    for (const proc of procs) {
        const o = byLegacy.get(proc.shopifyOrderId!);
        if (!o) continue; // pre-cutover / not yet mirrored — can't judge.
        let kind = classifyReversal(o, disputed.has(o.orderGid));
        if (!kind) {
            // Not reversed — but was the order edited down below dues after activation?
            const expected = isVolunteerById.get(proc.orgMembershipId ?? -1) ? settings?.volunteerDuesCents ?? 0 : settings?.normalDuesCents ?? 0;
            if (expected > 0 && o.totalCents + AMOUNT_TOLERANCE_CENTS < expected) kind = "AMOUNT_MISMATCH";
        }
        if (kind) {
            await raisePaymentException(kind, { shopifyOrderId: proc.shopifyOrderId, processId: proc.id });
            raised++;
        }
    }
    for (const e of enrolls) {
        const o = byLegacy.get(e.shopifyOrderId!);
        if (!o) continue;
        const kind = classifyReversal(o, disputed.has(o.orderGid));
        if (kind) {
            await raisePaymentException(kind, { shopifyOrderId: e.shopifyOrderId, programId: e.programId, personId: e.personId });
            raised++;
        }
    }
    return raised;
}

// ── entry point ──────────────────────────────────────────────────────────────

export interface ReconcileResult {
    configured: boolean;
    ordersScanned: number;
    reversalsRaised: number;
}

/**
 * One reconciliation pass. No-op (configured:false) when the mirror isn't wired.
 * Advances BoardSettings.shopifyReconcileCursorAt to the newest order it processed
 * so the next run only re-scans changed orders.
 */
export async function runReconcile(): Promise<ReconcileResult> {
    if (!mirror.isConfigured()) return { configured: false, ordersScanned: 0, reversalsRaised: 0 };

    const settings = await prisma.boardSettings.findUnique({ where: { id: 1 }, select: { shopifyReconcileCursorAt: true } });
    const cursor = settings?.shopifyReconcileCursorAt ?? null;

    const orders = await mirror.ordersChangedSince(cursor);
    let newCursor = cursor;
    for (const order of orders) {
        try {
            const claimed = await reconcileForwardMembership(order);
            if (!claimed) await reconcileForwardProgram(order);
        } catch (e) {
            logger.error(`[reconcile] forward pass failed for order ${order.legacyId ?? order.orderGid}:`, e);
        }
        if (order.updatedAt && (!newCursor || order.updatedAt > newCursor)) newCursor = order.updatedAt;
    }

    const reversalsRaised = await reconcileReversals();

    // Advance the cursor only after a clean pass, so a mid-run failure re-scans.
    if (newCursor && newCursor !== cursor) {
        await prisma.boardSettings.update({ where: { id: 1 }, data: { shopifyReconcileCursorAt: newCursor } });
    }

    return { configured: true, ordersScanned: orders.length, reversalsRaised };
}
