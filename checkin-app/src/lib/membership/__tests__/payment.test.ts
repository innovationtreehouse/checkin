/**
 * @jest-environment node
 */
/**
 * Unit test for the H2 fix in activate() (prisma mocked, no DB): a Shopify
 * payment (opts.via === "payment") must actually contain the membership
 * product (its Shopify variant) before a PENDING_PAYMENT process activates.
 *   - no membership variant in the order -> NOT activated, no paidAt, board alerted (notifyBoardPaidReject).
 *   - membership variant present         -> activates as before (status ACTIVE, membership ACTIVE).
 *   - a "certified" (board) activation never had an order to check, so it's exempt regardless.
 */
import { activate, activateByProcessId } from '@/lib/membership/payment';

jest.mock('@/lib/prisma', () => {
    const mock = {
        membershipProcess: { findUnique: jest.fn(), update: jest.fn() },
        membership: { findUnique: jest.fn(), update: jest.fn() },
        boardSettings: { findUnique: jest.fn() },
        auditLog: { create: jest.fn() },
        householdLead: { findMany: jest.fn().mockResolvedValue([]) },
        $queryRaw: jest.fn(),
        $transaction: jest.fn(),
    };
    mock.$transaction.mockImplementation((cb: (tx: typeof mock) => unknown) => cb(mock));
    return { __esModule: true, default: mock };
});
jest.mock('@/lib/email', () => ({ sendEmail: jest.fn().mockResolvedValue(true) }));
jest.mock('@/lib/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock('@/lib/membership/boardAlerts', () => ({ notifyBoardPaidReject: jest.fn().mockResolvedValue(undefined) }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const prisma = require('@/lib/prisma').default;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { notifyBoardPaidReject } = require('@/lib/membership/boardAlerts');

const PROCESS_ID = 5;
const MEMBERSHIP_ID = 9;

beforeEach(() => {
    jest.clearAllMocks();
    prisma.boardSettings.findUnique.mockResolvedValue({ normalDuesCents: 10000, volunteerDuesCents: 2500 });
    prisma.membership.findUnique.mockResolvedValue({ householdId: 3, isVolunteer: false });
});

it('does NOT activate a PENDING_PAYMENT process when the order has no membership item', async () => {
    prisma.membershipProcess.findUnique.mockResolvedValue({
        id: PROCESS_ID, status: 'PENDING_PAYMENT', paidAt: null, bgClearedAt: null, membershipId: MEMBERSHIP_ID,
    });

    await activateByProcessId(PROCESS_ID, 'order-1', false);

    expect(prisma.membershipProcess.update).not.toHaveBeenCalled();
    expect(prisma.membership.update).not.toHaveBeenCalled();
    expect(notifyBoardPaidReject).toHaveBeenCalledWith(PROCESS_ID);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
            data: expect.objectContaining({
                newData: expect.objectContaining({ status: 'PENDING_PAYMENT', noMembershipItem: true }),
            }),
        }),
    );
});

it('activates a PENDING_PAYMENT process when the order contains the membership item', async () => {
    prisma.membershipProcess.findUnique.mockResolvedValue({
        id: PROCESS_ID, status: 'PENDING_PAYMENT', paidAt: null, bgClearedAt: new Date(), membershipId: MEMBERSHIP_ID,
    });

    await activateByProcessId(PROCESS_ID, 'order-2', true);

    expect(prisma.membershipProcess.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE' }) }),
    );
    expect(prisma.membership.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: MEMBERSHIP_ID }, data: { status: 'ACTIVE' } }),
    );
    expect(notifyBoardPaidReject).not.toHaveBeenCalled();
});

it('a certified (board) activation is exempt from the membership-item check', async () => {
    // certifyPaymentPlan never has a Shopify order to check (via !== "payment"),
    // so it activates even though no hasMembershipItem is passed at all.
    prisma.membershipProcess.findUnique.mockResolvedValue({
        id: PROCESS_ID, status: 'PENDING_PAYMENT', paidAt: null, bgClearedAt: new Date(), membershipId: MEMBERSHIP_ID,
    });

    await activate(PROCESS_ID, { via: 'certified', actorId: 1 });

    expect(prisma.membershipProcess.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE' }) }),
    );
    expect(notifyBoardPaidReject).not.toHaveBeenCalled();
});
