/**
 * @jest-environment node
 */
/**
 * Matrix test for the Shopify reconciler (lib/finance/reconcile.ts). Real app DB,
 * mocked `shopify_read` mirror (fixtures) — so every taxonomy row is exercised
 * against real membership/program state without needing a second Postgres. Each
 * assertion also re-runs to prove idempotency (no double activation, no duplicate
 * PaymentException).
 */
import prisma from "@/lib/prisma";
import { runReconcile, raiseReversalByOrderId } from "@/lib/finance/reconcile";
import type { MirrorOrder } from "@/lib/shopifyRead/client";

jest.mock("@/lib/email", () => ({ sendEmail: jest.fn().mockResolvedValue(true) }));

// Mocked mirror — each test sets what the four read helpers return.
jest.mock("@/lib/shopifyRead/client", () => ({
    isConfigured: () => true,
    ordersChangedSince: jest.fn(async () => [] as MirrorOrder[]),
    ordersByLegacyIds: jest.fn(async () => [] as MirrorOrder[]),
    disputedOrderGids: jest.fn(async () => new Set<string>()),
}));
import * as mirror from "@/lib/shopifyRead/client";

const TAG = "reconcile-matrix-test";
const ordersChangedSince = mirror.ordersChangedSince as jest.Mock;
const ordersByLegacyIds = mirror.ordersByLegacyIds as jest.Mock;
const disputedOrderGids = mirror.disputedOrderGids as jest.Mock;

function order(overrides: Partial<MirrorOrder> & { legacyId: string }): MirrorOrder {
    return {
        orderGid: `gid://shopify/Order/${overrides.legacyId}`,
        customerEmail: null,
        financialStatus: "PAID",
        totalCents: 5000,
        subtotalCents: 5000,
        totalRefundedCents: 0,
        cancelledAt: null,
        updatedAt: new Date(),
        ...overrides,
    };
}

/** A household whose lead has `email`, an OrgMembership, and one process. */
async function makeApplicant(opts: {
    email: string;
    status: "PENDING_PAYMENT" | "ACTIVE";
    bgCleared?: boolean;
    isVolunteer?: boolean;
    shopifyOrderId?: string;
    paid?: boolean;
}): Promise<{ householdId: number; processId: number; membershipId: number }> {
    const hh = await prisma.household.create({ data: { name: `HH ${TAG} ${opts.email}` } });
    await prisma.person.create({
        data: { email: opts.email, name: `Lead ${opts.email}`, isHouseholdLead: true, householdId: hh.id },
    });
    const m = await prisma.orgMembership.create({
        data: { householdId: hh.id, status: opts.status === "ACTIVE" ? "ACTIVE" : "NONE", isVolunteer: !!opts.isVolunteer },
    });
    const proc = await prisma.orgMembershipProcess.create({
        data: {
            orgMembershipId: m.id,
            kind: "INITIAL",
            status: opts.status,
            bgClearedAt: opts.bgCleared ? new Date() : null,
            shopifyOrderId: opts.shopifyOrderId ?? null,
            paidAt: opts.paid ? new Date() : null,
        },
    });
    return { householdId: hh.id, processId: proc.id, membershipId: m.id };
}

beforeAll(async () => {
    await prisma.boardSettings.upsert({
        where: { id: 1 },
        create: { id: 1, normalDuesCents: 5000, volunteerDuesCents: 2000 },
        update: { normalDuesCents: 5000, volunteerDuesCents: 2000, shopifyReconcileCursorAt: null },
    });
});

afterEach(async () => {
    ordersChangedSince.mockResolvedValue([]);
    ordersByLegacyIds.mockResolvedValue([]);
    disputedOrderGids.mockResolvedValue(new Set());
    // Reset cursor so each test scans its own fixtures from scratch.
    await prisma.boardSettings.update({ where: { id: 1 }, data: { shopifyReconcileCursorAt: null } });
});

afterAll(async () => {
    const hhs = await prisma.household.findMany({ where: { name: { contains: TAG } }, select: { id: true } });
    const ids = hhs.map((h) => h.id);
    if (ids.length) {
        const procs = await prisma.orgMembershipProcess.findMany({ where: { orgMembership: { householdId: { in: ids } } }, select: { id: true } });
        await prisma.paymentException.deleteMany({ where: { processId: { in: procs.map((p) => p.id) } } });
        await prisma.orgMembershipProcess.deleteMany({ where: { orgMembership: { householdId: { in: ids } } } });
        await prisma.orgMembership.deleteMany({ where: { householdId: { in: ids } } });
        await prisma.person.deleteMany({ where: { householdId: { in: ids } } });
        await prisma.household.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.paymentException.deleteMany({ where: { shopifyOrderId: { startsWith: `${TAG}-` } } });
});

describe("forward recovery", () => {
    it("recovers a missed payment, advancing PENDING_PAYMENT past the paid checkpoint", async () => {
        const email = `recover-${TAG}@ex.com`;
        const oid = `${TAG}-100`;
        const { processId } = await makeApplicant({ email, status: "PENDING_PAYMENT", bgCleared: true });
        ordersChangedSince.mockResolvedValue([order({ legacyId: oid, customerEmail: email, totalCents: 5000 })]);

        const r1 = await runReconcile();
        expect(r1.configured).toBe(true);
        const proc = await prisma.orgMembershipProcess.findUnique({ where: { id: processId } });
        expect(proc?.status).toBe("ACTIVE");
        expect(proc?.paidAt).toBeTruthy();
        expect(proc?.shopifyOrderId).toBe(oid);
        // No exception for a clean recovery.
        expect(await prisma.paymentException.count({ where: { processId } })).toBe(0);

        // Idempotent: second run does nothing new (order now recorded on the process).
        await runReconcile();
        expect(await prisma.paymentException.count({ where: { processId } })).toBe(0);
    });

    it("holds at PENDING_BG_CLEARANCE when bg not cleared", async () => {
        const email = `hold-${TAG}@ex.com`;
        const { processId } = await makeApplicant({ email, status: "PENDING_PAYMENT", bgCleared: false });
        ordersChangedSince.mockResolvedValue([order({ legacyId: `${TAG}-101`, customerEmail: email })]);
        await runReconcile();
        const proc = await prisma.orgMembershipProcess.findUnique({ where: { id: processId } });
        expect(proc?.status).toBe("PENDING_BG_CLEARANCE");
        expect(proc?.paidAt).toBeTruthy();
    });

    it("raises AMOUNT_MISMATCH and does not activate when the order underpays dues", async () => {
        const email = `short-${TAG}@ex.com`;
        const oid = `${TAG}-102`;
        const { processId } = await makeApplicant({ email, status: "PENDING_PAYMENT", bgCleared: true });
        ordersChangedSince.mockResolvedValue([order({ legacyId: oid, customerEmail: email, totalCents: 1000 })]);
        await runReconcile();
        const proc = await prisma.orgMembershipProcess.findUnique({ where: { id: processId } });
        expect(proc?.status).toBe("PENDING_PAYMENT");
        expect(await prisma.paymentException.findFirst({ where: { kind: "AMOUNT_MISMATCH", shopifyOrderId: oid } })).toBeTruthy();
    });

    it("raises UNMATCHED_ORDER when the family has more than one pending process", async () => {
        const email = `ambig-${TAG}@ex.com`;
        const oid = `${TAG}-103`;
        const a = await makeApplicant({ email, status: "PENDING_PAYMENT", bgCleared: true });
        // A second PENDING_PAYMENT process on the SAME membership (email is @unique, so
        // ambiguity comes from two live processes for one family, not two households).
        await prisma.orgMembershipProcess.create({
            data: { orgMembershipId: a.membershipId, kind: "RENEWAL", status: "PENDING_PAYMENT", bgClearedAt: new Date() },
        });
        ordersChangedSince.mockResolvedValue([order({ legacyId: oid, customerEmail: email })]);
        await runReconcile();
        expect(await prisma.paymentException.findFirst({ where: { kind: "UNMATCHED_ORDER", shopifyOrderId: oid } })).toBeTruthy();
        const proc = await prisma.orgMembershipProcess.findUnique({ where: { id: a.processId } });
        expect(proc?.status).toBe("PENDING_PAYMENT");
    });

    it("ignores a paid order from an email with no pending membership (normal purchase)", async () => {
        ordersChangedSince.mockResolvedValue([order({ legacyId: `${TAG}-104`, customerEmail: `nobody-${TAG}@ex.com` })]);
        const before = await prisma.paymentException.count();
        await runReconcile();
        expect(await prisma.paymentException.count()).toBe(before);
    });

    it("raises REVERSED_BEFORE_ACTIVATION for a refunded order matching a pending process", async () => {
        const email = `prerev-${TAG}@ex.com`;
        const oid = `${TAG}-105`;
        const { processId } = await makeApplicant({ email, status: "PENDING_PAYMENT", bgCleared: true });
        ordersChangedSince.mockResolvedValue([order({ legacyId: oid, customerEmail: email, financialStatus: "REFUNDED", totalRefundedCents: 5000 })]);
        await runReconcile();
        const proc = await prisma.orgMembershipProcess.findUnique({ where: { id: processId } });
        expect(proc?.status).toBe("PENDING_PAYMENT");
        expect(await prisma.paymentException.findFirst({ where: { kind: "REVERSED_BEFORE_ACTIVATION", shopifyOrderId: oid } })).toBeTruthy();
    });
});

describe("reversal detection", () => {
    it("raises REFUND for a refunded order on an ACTIVE membership, leaving it ACTIVE", async () => {
        const oid = `${TAG}-200`;
        const { processId } = await makeApplicant({ email: `ref-${TAG}@ex.com`, status: "ACTIVE", paid: true, shopifyOrderId: oid });
        ordersByLegacyIds.mockResolvedValue([order({ legacyId: oid, financialStatus: "REFUNDED", totalRefundedCents: 5000 })]);

        await runReconcile();
        const proc = await prisma.orgMembershipProcess.findUnique({ where: { id: processId } });
        expect(proc?.status).toBe("ACTIVE"); // never auto-reverted
        expect(await prisma.paymentException.count({ where: { kind: "REFUND", processId } })).toBe(1);

        // Idempotent: a second run does not duplicate the exception.
        await runReconcile();
        expect(await prisma.paymentException.count({ where: { kind: "REFUND", processId } })).toBe(1);
    });

    it("raises CHARGEBACK (critical) when a dispute balance-txn exists", async () => {
        const oid = `${TAG}-201`;
        const { processId } = await makeApplicant({ email: `cb-${TAG}@ex.com`, status: "ACTIVE", paid: true, shopifyOrderId: oid });
        const o = order({ legacyId: oid, financialStatus: "PAID" });
        ordersByLegacyIds.mockResolvedValue([o]);
        disputedOrderGids.mockResolvedValue(new Set([o.orderGid]));

        await runReconcile();
        const ex = await prisma.paymentException.findFirst({ where: { kind: "CHARGEBACK", processId } });
        expect(ex?.severity).toBe("CRITICAL");
    });

    it("raises CANCELLED for a cancelled order", async () => {
        const oid = `${TAG}-202`;
        const { processId } = await makeApplicant({ email: `can-${TAG}@ex.com`, status: "ACTIVE", paid: true, shopifyOrderId: oid });
        ordersByLegacyIds.mockResolvedValue([order({ legacyId: oid, cancelledAt: new Date() })]);
        await runReconcile();
        expect(await prisma.paymentException.findFirst({ where: { kind: "CANCELLED", processId } })).toBeTruthy();
    });
});

describe("fast-path reversal webhook helper", () => {
    it("raiseReversalByOrderId maps an order to its process and is idempotent", async () => {
        const oid = `${TAG}-300`;
        const { processId } = await makeApplicant({ email: `fp-${TAG}@ex.com`, status: "ACTIVE", paid: true, shopifyOrderId: oid });
        expect(await raiseReversalByOrderId(oid, "REFUND")).toBe(true);
        await raiseReversalByOrderId(oid, "REFUND");
        expect(await prisma.paymentException.count({ where: { kind: "REFUND", processId } })).toBe(1);
    });
});
