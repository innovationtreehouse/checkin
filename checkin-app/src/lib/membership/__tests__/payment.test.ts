/**
 * @jest-environment node
 */
/**
 * Unit test for the H2 fix in activate() (prisma mocked, no DB): a Shopify
 * payment (opts.via === "payment") must cover the household's expected dues
 * before a PENDING_PAYMENT process activates.
 *   - paid < dues  -> NOT activated, no paidAt, board alerted (notifyBoardPaidReject).
 *   - paid >= dues -> activates as before (status ACTIVE, membership ACTIVE).
 */
import { activateByProcessId } from '@/lib/membership/payment';

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
const NORMAL_DUES_CENTS = 10000;

beforeEach(() => {
    jest.clearAllMocks();
    prisma.boardSettings.findUnique.mockResolvedValue({ normalDuesCents: NORMAL_DUES_CENTS, volunteerDuesCents: 2500 });
    prisma.membership.findUnique.mockResolvedValue({ householdId: 3, isVolunteer: false });
});

it('does NOT activate a PENDING_PAYMENT process when the order total is below dues', async () => {
    prisma.membershipProcess.findUnique.mockResolvedValue({
        id: PROCESS_ID, status: 'PENDING_PAYMENT', paidAt: null, bgClearedAt: null, membershipId: MEMBERSHIP_ID,
    });

    await activateByProcessId(PROCESS_ID, 'order-1', NORMAL_DUES_CENTS - 1);

    expect(prisma.membershipProcess.update).not.toHaveBeenCalled();
    expect(prisma.membership.update).not.toHaveBeenCalled();
    expect(notifyBoardPaidReject).toHaveBeenCalledWith(PROCESS_ID);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
            data: expect.objectContaining({
                newData: expect.objectContaining({ status: 'PENDING_PAYMENT', underpaid: true }),
            }),
        }),
    );
});

it('activates a PENDING_PAYMENT process when the order total meets dues', async () => {
    prisma.membershipProcess.findUnique.mockResolvedValue({
        id: PROCESS_ID, status: 'PENDING_PAYMENT', paidAt: null, bgClearedAt: new Date(), membershipId: MEMBERSHIP_ID,
    });

    await activateByProcessId(PROCESS_ID, 'order-2', NORMAL_DUES_CENTS);

    expect(prisma.membershipProcess.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE' }) }),
    );
    expect(prisma.membership.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: MEMBERSHIP_ID }, data: { status: 'ACTIVE' } }),
    );
    expect(notifyBoardPaidReject).not.toHaveBeenCalled();
});

it('does NOT activate when dues are unconfigured (expectedDuesCents 0), even for a positive payment', async () => {
    // BoardSettings dues default to 0 on a fresh/reset deploy; a 0 floor must NOT mean
    // "any payment covers it" — that would free-activate. Fail closed instead.
    prisma.boardSettings.findUnique.mockResolvedValue({ normalDuesCents: 0, volunteerDuesCents: 0 });
    prisma.membershipProcess.findUnique.mockResolvedValue({
        id: PROCESS_ID, status: 'PENDING_PAYMENT', paidAt: null, bgClearedAt: new Date(), membershipId: MEMBERSHIP_ID,
    });

    await activateByProcessId(PROCESS_ID, 'order-3', 5000);

    expect(prisma.membershipProcess.update).not.toHaveBeenCalled();
    expect(prisma.membership.update).not.toHaveBeenCalled();
    expect(notifyBoardPaidReject).toHaveBeenCalledWith(PROCESS_ID);
});
