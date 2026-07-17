import prisma from "@/lib/prisma";
import { isPaid, membershipVariantIdSet } from "@/lib/finance/reconcile";
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
    /**
     * How many membership/program variant ids the app is configured with. 0 means
     * the order side of the audit is vacuous for a DIFFERENT reason than backfill:
     * nothing tells us which orders should reconcile. The UI must distinguish this
     * from a genuinely clean report.
     */
    configuredVariants: number;
    orders: AuditOrderRow[];
    memberships: AuditMembershipRow[];
    enrollments: AuditEnrollmentRow[];
}

export async function runMatchAudit(): Promise<MatchAuditResult> {
    if (!mirror.isConfigured()) {
        return { configured: false, variantCoverage: { lines: 0, withVariant: 0 }, configuredVariants: 0, orders: [], memberships: [], enrollments: [] };
    }

    // ── the "should reconcile" variant set ────────────────────────────────────
    const [settings, programs, variantCoverage] = await Promise.all([
        prisma.boardSettings.findUnique({
            where: { id: 1 },
            select: { orgMembershipVariantId: true, shopifyNormalVariantId: true, shopifyVolunteerVariantId: true },
        }),
        prisma.program.findMany({
            select: { id: true, name: true, shopifyVariantId: true, shopifyOrgMemberVariantId: true, shopifyNonOrgMemberVariantId: true },
        }),
        mirror.lineVariantStats(),
    ]);

    // The same set the reconciler's item gate uses — shared, not copied, so the
    // two can't drift (#1074 was exactly that drift).
    const membershipVariants = membershipVariantIdSet(settings ?? null);
    const programByVariant = new Map<string, { id: number; name: string }>();
    for (const p of programs) {
        for (const v of [p.shopifyVariantId, p.shopifyOrgMemberVariantId, p.shopifyNonOrgMemberVariantId]) {
            if (v) programByVariant.set(v, { id: p.id, name: p.name });
        }
    }
    const allVariants = [...membershipVariants, ...programByVariant.keys()];

    // ── Shopify → activation: every reconcilable order accounted for ──────────
    const orders = await mirror.ordersForVariants(allVariants);
    const orderIds = orders.map((o) => o.legacyId).filter((v): v is string => !!v);

    // Claims are per-KIND, not per-order: a single checkout can carry membership
    // AND program lines, and "the membership process claimed this order" says
    // nothing about the program half. An ARCHIVED process is not a claim — the
    // application was abandoned, so its money is exactly the unclaimed kind.
    const [claimedProcs, claimedEnrolls, trackedExceptions] = await Promise.all([
        prisma.orgMembershipProcess.findMany({
            where: { shopifyOrderId: { in: orderIds }, status: { not: "ARCHIVED" } },
            select: { shopifyOrderId: true },
        }),
        prisma.programParticipant.findMany({ where: { shopifyOrderId: { in: orderIds } }, select: { shopifyOrderId: true, programId: true } }),
        prisma.paymentException.findMany({
            where: { shopifyOrderId: { in: orderIds }, status: { not: "RESOLVED" } },
            select: { shopifyOrderId: true },
        }),
    ]);
    const membershipClaimed = new Set(claimedProcs.map((r) => r.shopifyOrderId));
    const programsClaimed = new Map<string, Set<number>>();
    for (const r of claimedEnrolls) {
        if (!r.shopifyOrderId) continue;
        const set = programsClaimed.get(r.shopifyOrderId) ?? new Set<number>();
        set.add(r.programId);
        programsClaimed.set(r.shopifyOrderId, set);
    }
    const tracked = new Set(trackedExceptions.map((r) => r.shopifyOrderId));

    const orderRows: AuditOrderRow[] = orders.map((o) => {
        // What each matched variant should have produced, and whether it did.
        const unclaimed: string[] = [];
        const expected: string[] = [];
        for (const v of new Set(o.matchedVariantIds ?? [])) {
            if (membershipVariants.has(v)) {
                if (!expected.includes("membership")) {
                    expected.push("membership");
                    if (!(o.legacyId && membershipClaimed.has(o.legacyId))) unclaimed.push("membership");
                }
            } else {
                const program = programByVariant.get(v);
                const label = `program: ${program?.name ?? v}`;
                if (!expected.includes(label)) {
                    expected.push(label);
                    const claimedSet = o.legacyId ? programsClaimed.get(o.legacyId) : undefined;
                    if (!(program && claimedSet?.has(program.id))) unclaimed.push(label);
                }
            }
        }
        const bucket: OrderBucket =
            unclaimed.length === 0
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
            // MATCHED rows list everything the order bought; gap rows list only
            // what is still missing, so a half-claimed checkout names its gap.
            expected: unclaimed.length > 0 ? unclaimed : expected,
        };
    });

    // ── activation → Shopify: every activation has a payment basis ────────────
    // INITIAL/RENEWAL only: PERSON_BG processes carry no payment by design, so
    // including them would flood NO_PAYMENT_BASIS with false positives.
    const [procs, enrolls] = await Promise.all([
        prisma.orgMembershipProcess.findMany({
            where: { status: { in: ["ACTIVE", "PENDING_BG_CLEARANCE"] }, kind: { in: ["INITIAL", "RENEWAL"] } },
            select: {
                id: true,
                shopifyOrderId: true,
                certifiedById: true,
                orgMembership: { select: { household: { select: { name: true } } } },
            },
        }),
        prisma.programParticipant.findMany({
            where: { status: "ACTIVE" },
            select: {
                programId: true,
                personId: true,
                shopifyOrderId: true,
                wasOrgMemberAtApproval: true,
                program: { select: { name: true } },
                person: { select: { name: true } },
            },
        }),
    ]);
    // certifiedById has no Prisma relation — resolve the names in one batch.
    const certifierIds = [...new Set(procs.map((p) => p.certifiedById).filter((v): v is number => v != null))];
    const certifiers = certifierIds.length
        ? await prisma.person.findMany({ where: { id: { in: certifierIds } }, select: { id: true, name: true } })
        : [];
    const certifierName = new Map(certifiers.map((c) => [c.id, c.name]));

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
            : p.certifiedById != null
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

    return { configured: true, variantCoverage, configuredVariants: allVariants.length, orders: orderRows, memberships: membershipRows, enrollments: enrollmentRows };
}
