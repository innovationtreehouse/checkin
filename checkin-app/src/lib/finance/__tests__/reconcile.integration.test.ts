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

// Mocked mirror — each test sets what the read helpers return. Only the DB-backed
// reads are stubbed; orderAttr stays REAL (it's a pure parse of the mirrored
// note_attributes, and the tests should exercise the real thing).
jest.mock("@/lib/shopifyRead/client", () => ({
    ...jest.requireActual("@/lib/shopifyRead/client"),
    isConfigured: () => true,
    ordersChangedSince: jest.fn(async () => [] as MirrorOrder[]),
    ordersByLegacyIds: jest.fn(async () => [] as MirrorOrder[]),
    disputedOrderGids: jest.fn(async () => new Set<string>()),
    // Default [] = a pre-#1048 order with no mirrored line variant ids, which drives
    // the reconciler's transitional amount-gate fallback. Tests of the variant path
    // set this explicitly.
    orderLineVariantIds: jest.fn(async () => [] as string[]),
}));
import * as mirror from "@/lib/shopifyRead/client";

const TAG = "reconcile-matrix-test";
// A membership variant id the board has configured; #1048 mirrors it onto order lines.
const MEMBERSHIP_VARIANT = "variant-normal-1";
const ordersChangedSince = mirror.ordersChangedSince as jest.Mock;
const ordersByLegacyIds = mirror.ordersByLegacyIds as jest.Mock;
const disputedOrderGids = mirror.disputedOrderGids as jest.Mock;
const orderLineVariantIds = mirror.orderLineVariantIds as jest.Mock;

function order(overrides: Partial<MirrorOrder> & { legacyId: string }): MirrorOrder {
    return {
        orderGid: `gid://shopify/Order/${overrides.legacyId}`,
        customerEmail: null,
        financialStatus: "PAID",
        totalCents: 5000,
        subtotalCents: 5000,
        totalRefundedCents: 0,
        discountCents: 0,
        discountCodes: [],
        cancelledAt: null,
        updatedAt: new Date(),
        // Default null = an order synced before #1029, i.e. the email-fallback path.
        // Tests of the preferred path pass noteAttributes explicitly.
        noteAttributes: null,
        ...overrides,
    };
}

/** Cart attributes as the mirror stores them (#1029). */
const attrs = (o: Record<string, string>) => Object.entries(o).map(([key, value]) => ({ key, value }));

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
        create: { id: 1, normalDuesCents: 5000, volunteerDuesCents: 2000, shopifyNormalVariantId: MEMBERSHIP_VARIANT },
        update: { normalDuesCents: 5000, volunteerDuesCents: 2000, shopifyNormalVariantId: MEMBERSHIP_VARIANT, shopifyReconcileCursorAt: null },
    });
});

afterEach(async () => {
    ordersChangedSince.mockResolvedValue([]);
    ordersByLegacyIds.mockResolvedValue([]);
    disputedOrderGids.mockResolvedValue(new Set());
    orderLineVariantIds.mockResolvedValue([]);
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

    it("recovers a couponed order below gross dues (variant match), no AMOUNT_MISMATCH", async () => {
        // #1048: the volunteer rate / promos are Shopify coupons, so a valid order's
        // total is below gross dues. It carries a known membership variant line → recover.
        const email = `coupon-${TAG}@ex.com`;
        const oid = `${TAG}-120`;
        const { processId } = await makeApplicant({ email, status: "PENDING_PAYMENT", bgCleared: true });
        orderLineVariantIds.mockResolvedValue([MEMBERSHIP_VARIANT]);
        ordersChangedSince.mockResolvedValue([
            order({ legacyId: oid, customerEmail: email, totalCents: 2000, discountCents: 3000, discountCodes: ["VOLUNTEER50"] }),
        ]);
        await runReconcile();
        const proc = await prisma.orgMembershipProcess.findUnique({ where: { id: processId } });
        expect(proc?.status).toBe("ACTIVE");
        expect(proc?.shopifyOrderId).toBe(oid);
        expect(await prisma.paymentException.count({ where: { kind: "AMOUNT_MISMATCH", processId } })).toBe(0);
    });

    it("raises NO_ITEM when a variant-mirrored order contains no membership product", async () => {
        const email = `noitem-${TAG}@ex.com`;
        const oid = `${TAG}-121`;
        const { processId } = await makeApplicant({ email, status: "PENDING_PAYMENT", bgCleared: true });
        // Order lines are mirrored, but none is a membership variant (e.g. a t-shirt).
        orderLineVariantIds.mockResolvedValue(["variant-tshirt-99"]);
        ordersChangedSince.mockResolvedValue([order({ legacyId: oid, customerEmail: email, totalCents: 5000 })]);
        await runReconcile();
        expect((await prisma.orgMembershipProcess.findUnique({ where: { id: processId } }))?.status).toBe("PENDING_PAYMENT");
        expect(await prisma.paymentException.findFirst({ where: { kind: "NO_ITEM", shopifyOrderId: oid } })).toBeTruthy();
    });

    it("pre-backfill order (no variant ids) genuinely short of dues still raises AMOUNT_MISMATCH", async () => {
        // orderLineVariantIds default [] = pre-#1048, no discount codes → amount fallback.
        const email = `prebackfill-${TAG}@ex.com`;
        const oid = `${TAG}-122`;
        const { processId } = await makeApplicant({ email, status: "PENDING_PAYMENT", bgCleared: true });
        ordersChangedSince.mockResolvedValue([order({ legacyId: oid, customerEmail: email, totalCents: 1000, discountCents: 0, discountCodes: [] })]);
        await runReconcile();
        expect((await prisma.orgMembershipProcess.findUnique({ where: { id: processId } }))?.status).toBe("PENDING_PAYMENT");
        expect(await prisma.paymentException.findFirst({ where: { kind: "AMOUNT_MISMATCH", shopifyOrderId: oid } })).toBeTruthy();
    });

    it("prefers the Membership_Process_ID cart attribute over the email heuristic", async () => {
        const email = `attr-${TAG}@ex.com`;
        const oid = `${TAG}-110`;
        const { processId } = await makeApplicant({ email, status: "PENDING_PAYMENT", bgCleared: true });
        // No customer email on the order at all — the attribute alone must carry it.
        ordersChangedSince.mockResolvedValue([
            order({ legacyId: oid, customerEmail: null, noteAttributes: attrs({ Membership_Process_ID: String(processId) }) }),
        ]);
        await runReconcile();
        const proc = await prisma.orgMembershipProcess.findUnique({ where: { id: processId } });
        expect(proc?.status).toBe("ACTIVE");
        expect(proc?.shopifyOrderId).toBe(oid);
    });

    it("attribute disambiguates what email alone could not (two pending processes)", async () => {
        const email = `attrambig-${TAG}@ex.com`;
        const oid = `${TAG}-111`;
        const a = await makeApplicant({ email, status: "PENDING_PAYMENT", bgCleared: true });
        const second = await prisma.orgMembershipProcess.create({
            data: { orgMembershipId: a.membershipId, kind: "RENEWAL", status: "PENDING_PAYMENT", bgClearedAt: new Date() },
        });
        // Email-only would raise UNMATCHED_ORDER here; the attribute names the process.
        ordersChangedSince.mockResolvedValue([
            order({ legacyId: oid, customerEmail: email, noteAttributes: attrs({ Membership_Process_ID: String(second.id) }) }),
        ]);
        await runReconcile();
        expect(await prisma.paymentException.findFirst({ where: { kind: "UNMATCHED_ORDER", shopifyOrderId: oid } })).toBeNull();
        expect((await prisma.orgMembershipProcess.findUnique({ where: { id: second.id } }))?.status).toBe("ACTIVE");
        // The sibling is untouched — the money was credited to exactly one process.
        expect((await prisma.orgMembershipProcess.findUnique({ where: { id: a.processId } }))?.status).toBe("PENDING_PAYMENT");
    });

    it("raises UNMATCHED_ORDER when the attribute names a process that does not exist", async () => {
        const oid = `${TAG}-112`;
        ordersChangedSince.mockResolvedValue([
            order({ legacyId: oid, noteAttributes: attrs({ Membership_Process_ID: "99999999" }) }),
        ]);
        await runReconcile();
        expect(await prisma.paymentException.findFirst({ where: { kind: "UNMATCHED_ORDER", shopifyOrderId: oid } })).toBeTruthy();
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

    it("does not raise AMOUNT_MISMATCH on a couponed order below gross dues (post-activation)", async () => {
        // ACTIVE membership paid with a coupon: total is below gross dues but the
        // discount explains the gap — not a post-activation edit-down. No exception.
        const oid = `${TAG}-203`;
        const { processId } = await makeApplicant({ email: `revcoupon-${TAG}@ex.com`, status: "ACTIVE", paid: true, shopifyOrderId: oid });
        ordersByLegacyIds.mockResolvedValue([order({ legacyId: oid, financialStatus: "PAID", totalCents: 2000, discountCents: 3000, discountCodes: ["VOLUNTEER50"] })]);
        await runReconcile();
        expect((await prisma.orgMembershipProcess.findUnique({ where: { id: processId } }))?.status).toBe("ACTIVE");
        expect(await prisma.paymentException.count({ where: { kind: "AMOUNT_MISMATCH", processId } })).toBe(0);
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
