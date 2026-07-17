/**
 * @jest-environment node
 */
/**
 * Unit tests for the bidirectional match audit's BUCKETING — the part where a
 * wrong branch sends the board chasing the wrong money. Prisma and the mirror
 * are both stubbed at the module boundary (house pattern); the mirror SQL is
 * covered in lib/shopifyRead/__tests__/client.test.ts.
 */
import { runMatchAudit } from '../matchAudit';

const prismaMock = {
    boardSettings: { findUnique: jest.fn() },
    program: { findMany: jest.fn() },
    orgMembershipProcess: { findMany: jest.fn() },
    programParticipant: { findMany: jest.fn() },
    paymentException: { findMany: jest.fn() },
    person: { findMany: jest.fn() },
};
// The factories defer every dereference to call time (jest.mock is hoisted above
// the consts, so touching them during factory evaluation would hit the TDZ).
jest.mock('@/lib/prisma', () => ({
    __esModule: true,
    default: {
        boardSettings: { findUnique: (...a: unknown[]) => prismaMock.boardSettings.findUnique(...a) },
        program: { findMany: (...a: unknown[]) => prismaMock.program.findMany(...a) },
        orgMembershipProcess: { findMany: (...a: unknown[]) => prismaMock.orgMembershipProcess.findMany(...a) },
        programParticipant: { findMany: (...a: unknown[]) => prismaMock.programParticipant.findMany(...a) },
        paymentException: { findMany: (...a: unknown[]) => prismaMock.paymentException.findMany(...a) },
        person: { findMany: (...a: unknown[]) => prismaMock.person.findMany(...a) },
    },
}));

const mirrorMock = {
    isConfigured: jest.fn(),
    lineVariantStats: jest.fn(),
    ordersForVariants: jest.fn(),
    orderLegacyIdsPresent: jest.fn(),
};
jest.mock('@/lib/shopifyRead/client', () => ({
    isConfigured: () => mirrorMock.isConfigured(),
    lineVariantStats: () => mirrorMock.lineVariantStats(),
    ordersForVariants: (...a: unknown[]) => mirrorMock.ordersForVariants(...a),
    orderLegacyIdsPresent: (...a: unknown[]) => mirrorMock.orderLegacyIdsPresent(...a),
}));

const paidOrder = (legacyId: string, over: Partial<Record<string, unknown>> = {}) => ({
    legacyId,
    name: `#${legacyId}`,
    customerEmail: 'buyer@example.com',
    financialStatus: 'PAID',
    totalCents: 5000,
    totalRefundedCents: 0,
    cancelledAt: null,
    matchedVariantIds: ['111'],
    ...over,
});

beforeEach(() => {
    jest.clearAllMocks();
    mirrorMock.isConfigured.mockReturnValue(true);
    mirrorMock.lineVariantStats.mockResolvedValue({ lines: 10, withVariant: 10 });
    mirrorMock.ordersForVariants.mockResolvedValue([]);
    mirrorMock.orderLegacyIdsPresent.mockResolvedValue(new Set());
    prismaMock.boardSettings.findUnique.mockResolvedValue({
        orgMembershipVariantId: '111',
        shopifyNormalVariantId: null,
        shopifyVolunteerVariantId: '112',
    });
    prismaMock.program.findMany.mockResolvedValue([
        { id: 7, name: 'Robotics', shopifyVariantId: '222', shopifyOrgMemberVariantId: null, shopifyNonOrgMemberVariantId: null },
    ]);
    prismaMock.orgMembershipProcess.findMany.mockResolvedValue([]);
    prismaMock.programParticipant.findMany.mockResolvedValue([]);
    prismaMock.paymentException.findMany.mockResolvedValue([]);
    prismaMock.person.findMany.mockResolvedValue([]);
});

it('reports configured:false without touching prisma or the mirror data when unwired', async () => {
    mirrorMock.isConfigured.mockReturnValue(false);
    const r = await runMatchAudit();
    expect(r.configured).toBe(false);
    expect(mirrorMock.ordersForVariants).not.toHaveBeenCalled();
});

it('asks the mirror for exactly the union of settings + program variants', async () => {
    await runMatchAudit();
    const asked = mirrorMock.ordersForVariants.mock.calls[0][0] as string[];
    expect([...asked].sort()).toEqual(['111', '112', '222']);
});

describe('order buckets (Shopify → activation)', () => {
    it('claimed by a membership process → MATCHED', async () => {
        mirrorMock.ordersForVariants.mockResolvedValue([paidOrder('900')]);
        // First orgMembershipProcess.findMany call is the claim lookup; second is the activation sweep.
        prismaMock.orgMembershipProcess.findMany
            .mockResolvedValueOnce([{ shopifyOrderId: '900' }])
            .mockResolvedValueOnce([]);
        const r = await runMatchAudit();
        expect(r.orders[0].bucket).toBe('MATCHED');
    });

    it('unclaimed but already tracked by an unresolved PaymentException → TRACKED_EXCEPTION, not a new gap', async () => {
        mirrorMock.ordersForVariants.mockResolvedValue([paidOrder('901')]);
        prismaMock.paymentException.findMany.mockResolvedValue([{ shopifyOrderId: '901' }]);
        const r = await runMatchAudit();
        expect(r.orders[0].bucket).toBe('TRACKED_EXCEPTION');
    });

    it('paid, variant-matched, claimed by nothing → UNCLAIMED_PAID (the gap), naming what it should have bought', async () => {
        mirrorMock.ordersForVariants.mockResolvedValue([paidOrder('902', { matchedVariantIds: ['111', '222'] })]);
        const r = await runMatchAudit();
        expect(r.orders[0].bucket).toBe('UNCLAIMED_PAID');
        expect(r.orders[0].expected.sort()).toEqual(['membership', 'program: Robotics']);
    });

    it('unclaimed but refunded/cancelled/pending → UNCLAIMED_UNPAID (informational, not the paid gap)', async () => {
        mirrorMock.ordersForVariants.mockResolvedValue([
            paidOrder('903', { totalRefundedCents: 5000, financialStatus: 'REFUNDED' }),
            paidOrder('904', { financialStatus: 'PENDING' }),
        ]);
        const r = await runMatchAudit();
        expect(r.orders.map((o) => o.bucket)).toEqual(['UNCLAIMED_UNPAID', 'UNCLAIMED_UNPAID']);
    });
});

describe('membership buckets (activation → Shopify)', () => {
    const proc = (id: number, over: Partial<Record<string, unknown>> = {}) => ({
        id,
        shopifyOrderId: null,
        certifiedById: null,
        orgMembership: { household: { name: `House ${id}` } },
        ...over,
    });

    it('classifies all four buckets, resolving certifier names', async () => {
        prismaMock.orgMembershipProcess.findMany
            .mockResolvedValueOnce([]) // claim lookup
            .mockResolvedValueOnce([
                proc(1, { shopifyOrderId: '800' }),
                proc(2, { shopifyOrderId: '801' }),
                proc(3, { certifiedById: 42 }),
                proc(4),
            ]);
        mirrorMock.orderLegacyIdsPresent.mockResolvedValue(new Set(['800']));
        prismaMock.person.findMany.mockResolvedValue([{ id: 42, name: 'Board Bob' }]);

        const r = await runMatchAudit();
        expect(r.memberships.map((m) => m.bucket)).toEqual([
            'ORDER_MATCHED',
            'ORDER_NOT_IN_MIRROR',
            'MANUAL_CERTIFIED',
            'NO_PAYMENT_BASIS',
        ]);
        expect(r.memberships[2].certifiedByName).toBe('Board Bob');
    });

    it('sweeps only payment-bearing kinds — PERSON_BG processes must never appear as gaps', async () => {
        await runMatchAudit();
        const sweep = prismaMock.orgMembershipProcess.findMany.mock.calls[1][0];
        expect(sweep.where.kind).toEqual({ in: ['INITIAL', 'RENEWAL'] });
        expect(sweep.where.status).toEqual({ in: ['ACTIVE', 'PENDING_BG_CLEARANCE'] });
    });
});

describe('enrollment buckets', () => {
    const enroll = (personId: number, over: Partial<Record<string, unknown>> = {}) => ({
        programId: 7,
        personId,
        shopifyOrderId: null,
        wasOrgMemberAtApproval: null,
        program: { name: 'Robotics' },
        person: { name: `Kid ${personId}` },
        ...over,
    });

    it('order-backed, scholarship-approved, and basis-less enrollments land in their buckets', async () => {
        prismaMock.programParticipant.findMany
            .mockResolvedValueOnce([]) // claim lookup
            .mockResolvedValueOnce([
                enroll(1, { shopifyOrderId: '700' }),
                enroll(2, { wasOrgMemberAtApproval: true }),
                enroll(3),
            ]);
        mirrorMock.orderLegacyIdsPresent.mockResolvedValue(new Set(['700']));

        const r = await runMatchAudit();
        expect(r.enrollments.map((e) => e.bucket)).toEqual(['ORDER_MATCHED', 'SCHOLARSHIP_APPROVED', 'NO_PAYMENT_BASIS']);
    });
});
