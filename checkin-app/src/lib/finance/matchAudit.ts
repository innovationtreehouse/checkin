import prisma from "@/lib/prisma";
import { config, DEV_MOCK_MEMBERSHIP_VARIANT_ID } from "@/lib/config";
import * as mirror from "@/lib/shopifyRead/client";

/**
 * Bidirectional Shopify ↔ activation match audit — the completeness check the
 * daily reconciler deliberately is not.
 *
 * The reconciler (reconcile.ts) is a cursor-driven recovery loop: it acts on
 * orders it can attribute and silently passes over the rest, and its reversal
 * pass only inspects activations that already carry an order id. That leaves
 * four populations nobody ever lists:
 *   - paid membership/program orders claimed by nothing (money in, no access),
 *   - activations whose order id isn't in the mirror (recorded, unverifiable),
 *   - activations with NO payment basis at all (access, no money) — the
 *     ACTIVE_WITHOUT_PAYMENT case that has had an enum value and board-alert
 *     copy since the reconciler shipped, but which nothing ever computed,
 *   - the legitimately-manual class (board-certified memberships, approved
 *     scholarships) that an auditor must see separated, not buried.
 *
 * "Should reconcile" is decided by VARIANT ID, the same key the storefront
 * links are built from: BoardSettings holds the membership variants, Program
 * rows hold the program variants. An order with none of those variants on any
 * line (donation, t-shirt) is out of scope by design and never reported.
 *
 * Read-only: this REPORTS; it raises no PaymentExceptions and changes nothing.
 * On-demand only (board click) — it reads the whole mirror-relevant surface,
 * which is exactly the kind of query the scale-to-zero cadence exists to bound.
 */

export type OrderBucket =
    /** Claimed by a membership process or program enrollment. */
    | "MATCHED"
    /** Not claimed, but an open/acknowledged PaymentException already tracks it. */
    | "TRACKED_EXCEPTION"
    /** Money is in, variant says membership/program, nothing claims it. THE gap. */
    | "UNCLAIMED_PAID"
    /** Not (or no longer) paid — pending/authorized/refunded/cancelled and unclaimed. Informational. */
    | "UNCLAIMED_UNPAID";

export interface AuditOrderRow {
    bucket: OrderBucket;
    orderLegacyId: string | null;
    /** Shopify order name (#1042). */
    name: string | null;
    customerEmail: string | null;
    financialStatus: string | null;
    totalCents: number;
    /** Which membership/program the variant match points at, e.g. "membership", "program: Robotics". */
    expected: string[];
}

export type MembershipBucket = "ORDER_MATCHED" | "MANUAL_CERTIFIED" | "ORDER_NOT_IN_MIRROR" | "NO_PAYMENT_BASIS";
export type EnrollmentBucket = "ORDER_MATCHED" | "SCHOLARSHIP_APPROVED" | "ORDER_NOT_IN_MIRROR" | "NO_PAYMENT_BASIS";

export interface AuditMembershipRow {
    bucket: MembershipBucket;
    processId: number;
    householdName: string | null;
    shopifyOrderId: string | null;
    /** Who certified, for the MANUAL_CERTIFIED rows — the "what is in audit as manual" answer. */
    certifiedByName: string | null;
}

export interface AuditEnrollmentRow {
    bucket: EnrollmentBucket;
    programId: number;
    programName: string;
    personId: number;
    personName: string | null;
    shopifyOrderId: string | null;
}

export interface MatchAuditResult {
    configured: boolean;
    /**
     * Mirror line rows carrying a variant id vs total. When withVariant is 0 while
     * lines exist, the mirror predates the variant columns and the order-side audit
     * is vacuous — run an s-read BACKFILL sync first. The UI must show this instead
     * of an empty (falsely clean) report.
     */
    variantCoverage: { lines: number; withVariant: number };
    orders: AuditOrderRow[];
    memberships: AuditMembershipRow[];
    enrollments: AuditEnrollmentRow[];
}

/** Same money-in predicate the reconciler uses (reconcile.ts isPaid). */
function isPaid(o: { financialStatus: string | null; cancelledAt: Date | null; totalRefundedCents: number }): boolean {
    const s = (o.financialStatus ?? "").toUpperCase();
    return (s === "PAID" || s === "PARTIALLY_PAID") && !o.cancelledAt && o.totalRefundedCents === 0;
}

export async function runMatchAudit(): Promise<MatchAuditResult> {
    if (!mirror.isConfigured()) {
        return { configured: false, variantCoverage: { lines: 0, withVariant: 0 }, orders: [], memberships: [], enrollments: [] };
    }

    // ── the "should reconcile" variant set ────────────────────────────────────
    const settings = await prisma.boardSettings.findUnique({
        where: { id: 1 },
        select: { orgMembershipVariantId: true, shopifyNormalVariantId: true, shopifyVolunteerVariantId: true },
    });
    const programs = await prisma.program.findMany({
        select: { id: true, name: true, shopifyVariantId: true, shopifyOrgMemberVariantId: true, shopifyNonOrgMemberVariantId: true },
    });

    // Same set the reconciler's item gate builds (reconcile.ts, #1074), dev-mock
    // variant included so a mock-active local env audits its own test orders.
    const membershipVariants = new Set(
        [
            settings?.orgMembershipVariantId,
            settings?.shopifyNormalVariantId,
            settings?.shopifyVolunteerVariantId,
            config.shopifyMockActive() ? DEV_MOCK_MEMBERSHIP_VARIANT_ID : null,
        ].filter((v): v is string => !!v),
    );
    const programByVariant = new Map<string, { id: number; name: string }>();
    for (const p of programs) {
        for (const v of [p.shopifyVariantId, p.shopifyOrgMemberVariantId, p.shopifyNonOrgMemberVariantId]) {
            if (v) programByVariant.set(v, { id: p.id, name: p.name });
        }
    }
    const allVariants = [...membershipVariants, ...programByVariant.keys()];

    const variantCoverage = await mirror.lineVariantStats();

    // ── Shopify → activation: every reconcilable order accounted for ──────────
    const orders = await mirror.ordersForVariants(allVariants);
    const orderIds = orders.map((o) => o.legacyId).filter((v): v is string => !!v);

    const [claimedProcs, claimedEnrolls, trackedExceptions] = await Promise.all([
        prisma.orgMembershipProcess.findMany({ where: { shopifyOrderId: { in: orderIds } }, select: { shopifyOrderId: true } }),
        prisma.programParticipant.findMany({ where: { shopifyOrderId: { in: orderIds } }, select: { shopifyOrderId: true } }),
        prisma.paymentException.findMany({
            where: { shopifyOrderId: { in: orderIds }, status: { not: "RESOLVED" } },
            select: { shopifyOrderId: true },
        }),
    ]);
    const claimed = new Set([...claimedProcs, ...claimedEnrolls].map((r) => r.shopifyOrderId));
    const tracked = new Set(trackedExceptions.map((r) => r.shopifyOrderId));

    const orderRows: AuditOrderRow[] = orders.map((o) => {
        const expected = (o.matchedVariantIds ?? []).map((v) =>
            membershipVariants.has(v) ? "membership" : `program: ${programByVariant.get(v)?.name ?? v}`,
        );
        const bucket: OrderBucket =
            o.legacyId && claimed.has(o.legacyId)
                ? "MATCHED"
                : o.legacyId && tracked.has(o.legacyId)
                  ? "TRACKED_EXCEPTION"
                  : isPaid(o)
                    ? "UNCLAIMED_PAID"
                    : "UNCLAIMED_UNPAID";
        return {
            bucket,
            orderLegacyId: o.legacyId,
            name: o.name,
            customerEmail: o.customerEmail,
            financialStatus: o.financialStatus,
            totalCents: o.totalCents,
            expected: [...new Set(expected)],
        };
    });

    // ── activation → Shopify: every activation has a payment basis ────────────
    // INITIAL/RENEWAL only: PERSON_BG processes carry no payment by design, so
    // including them would flood NO_PAYMENT_BASIS with false positives.
    const procs = await prisma.orgMembershipProcess.findMany({
        where: { status: { in: ["ACTIVE", "PENDING_BG_CLEARANCE"] }, kind: { in: ["INITIAL", "RENEWAL"] } },
        select: {
            id: true,
            shopifyOrderId: true,
            certifiedById: true,
            orgMembership: { select: { household: { select: { name: true } } } },
        },
    });
    // certifiedById has no Prisma relation — resolve the names in one batch.
    const certifierIds = [...new Set(procs.map((p) => p.certifiedById).filter((v): v is number => v != null))];
    const certifiers = certifierIds.length
        ? await prisma.person.findMany({ where: { id: { in: certifierIds } }, select: { id: true, name: true } })
        : [];
    const certifierName = new Map(certifiers.map((c) => [c.id, c.name]));
    const enrolls = await prisma.programParticipant.findMany({
        where: { status: "ACTIVE" },
        select: {
            programId: true,
            personId: true,
            shopifyOrderId: true,
            wasOrgMemberAtApproval: true,
            program: { select: { name: true } },
            person: { select: { name: true } },
        },
    });

    const activationOrderIds = [
        ...procs.map((p) => p.shopifyOrderId),
        ...enrolls.map((e) => e.shopifyOrderId),
    ].filter((v): v is string => !!v);
    const inMirror = await mirror.orderLegacyIdsPresent([...new Set(activationOrderIds)]);

    const membershipRows: AuditMembershipRow[] = procs.map((p) => ({
        bucket: p.shopifyOrderId
            ? inMirror.has(p.shopifyOrderId)
                ? "ORDER_MATCHED"
                : "ORDER_NOT_IN_MIRROR"
            : p.certifiedById
              ? "MANUAL_CERTIFIED"
              : "NO_PAYMENT_BASIS",
        processId: p.id,
        householdName: p.orgMembership?.household?.name ?? null,
        shopifyOrderId: p.shopifyOrderId,
        certifiedByName: p.certifiedById != null ? (certifierName.get(p.certifiedById) ?? `person ${p.certifiedById}`) : null,
    }));

    const enrollmentRows: AuditEnrollmentRow[] = enrolls.map((e) => ({
        bucket: e.shopifyOrderId
            ? inMirror.has(e.shopifyOrderId)
                ? "ORDER_MATCHED"
                : "ORDER_NOT_IN_MIRROR"
            : e.wasOrgMemberAtApproval != null
              ? "SCHOLARSHIP_APPROVED"
              : "NO_PAYMENT_BASIS",
        programId: e.programId,
        programName: e.program.name,
        personId: e.personId,
        personName: e.person.name,
        shopifyOrderId: e.shopifyOrderId,
    }));

    return { configured: true, variantCoverage, orders: orderRows, memberships: membershipRows, enrollments: enrollmentRows };
}
