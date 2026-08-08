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
 *
 * Also covers the activation email's INITIAL/RENEWAL split: a renewing household
 * is thanked for renewing, not welcomed as if it were new.
 */
import { activate, activateByProcessId } from '@/lib/membership/payment';

jest.mock('@/lib/prisma', () => {
    const mock = {
        orgMembershipProcess: { findUnique: jest.fn(), update: jest.fn() },
        orgMembership: { findUnique: jest.fn(), update: jest.fn() },
        boardSettings: { findUnique: jest.fn() },
        auditLog: { create: jest.fn() },
        person: { findMany: jest.fn().mockResolvedValue([]) },
        $queryRaw: jest.fn(),
        $transaction: jest.fn(),
    };
    mock.$transaction.mockImplementation((cb: (tx: typeof mock) => unknown) => cb(mock));
    return { __esModule: true, default: mock };
});
jest.mock('@/lib/email', () => ({ sendEmail: jest.fn().mockResolvedValue(true) }));
jest.mock('@/lib/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock('@/lib/membership/boardAlerts', () => ({ notifyBoardPaidReject: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/lib/emailRecipients', () => ({ emailHouseholdLeads: jest.fn().mockResolvedValue(undefined) }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const prisma = require('@/lib/prisma').default;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { notifyBoardPaidReject } = require('@/lib/membership/boardAlerts');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { emailHouseholdLeads } = require('@/lib/emailRecipients');

const PROCESS_ID = 5;
const MEMBERSHIP_ID = 9;

beforeEach(() => {
    jest.clearAllMocks();
    prisma.boardSettings.findUnique.mockResolvedValue({ standardMembershipFeeCents: 10000, volunteerMembershipFeeCents: 2500 });
    prisma.orgMembership.findUnique.mockResolvedValue({ householdId: 3, isVolunteer: false });
});

it('does NOT activate a PENDING_PAYMENT process when the order has no membership item', async () => {
    prisma.orgMembershipProcess.findUnique.mockResolvedValue({
        id: PROCESS_ID, status: 'PENDING_PAYMENT', paidAt: null, bgClearedAt: null, orgMembershipId: MEMBERSHIP_ID,
    });

    await activateByProcessId(PROCESS_ID, 'order-1', false);

    expect(prisma.orgMembershipProcess.update).not.toHaveBeenCalled();
    expect(prisma.orgMembership.update).not.toHaveBeenCalled();
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
    prisma.orgMembershipProcess.findUnique.mockResolvedValue({
        id: PROCESS_ID, status: 'PENDING_PAYMENT', paidAt: null, bgClearedAt: new Date(), orgMembershipId: MEMBERSHIP_ID,
    });

    await activateByProcessId(PROCESS_ID, 'order-2', true);

    expect(prisma.orgMembershipProcess.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE' }) }),
    );
    expect(prisma.orgMembership.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: MEMBERSHIP_ID }, data: { status: 'ACTIVE' } }),
    );
    expect(notifyBoardPaidReject).not.toHaveBeenCalled();
});

it('welcomes an INITIAL household on activation', async () => {
    prisma.orgMembershipProcess.findUnique.mockResolvedValue({
        id: PROCESS_ID, kind: 'INITIAL', status: 'PENDING_PAYMENT', paidAt: null, bgClearedAt: new Date(), orgMembershipId: MEMBERSHIP_ID,
    });

    await activateByProcessId(PROCESS_ID, 'order-3', true);

    const [, subject, body] = emailHouseholdLeads.mock.calls[0];
    expect(subject).toBe('Welcome to the Treehouse — your membership is active!');
    expect(body).toContain('Welcome to the Innovation Treehouse community');
});

it('thanks a RENEWAL household for renewing instead of welcoming it', async () => {
    prisma.orgMembershipProcess.findUnique.mockResolvedValue({
        id: PROCESS_ID, kind: 'RENEWAL', status: 'PENDING_PAYMENT', paidAt: null, bgClearedAt: new Date(), orgMembershipId: MEMBERSHIP_ID,
    });

    await activateByProcessId(PROCESS_ID, 'order-4', true);

    const [, subject, body] = emailHouseholdLeads.mock.calls[0];
    expect(subject).toBe('Thank you for renewing — your Treehouse membership is active!');
    expect(subject).not.toContain('Welcome');
    expect(body).toContain('Thank you for renewing');
});

it('a certified (board) activation is exempt from the membership-item check', async () => {
    // certifyPaymentPlan never has a Shopify order to check (via !== "payment"),
    // so it activates even though no hasMembershipItem is passed at all.
    prisma.orgMembershipProcess.findUnique.mockResolvedValue({
        id: PROCESS_ID, status: 'PENDING_PAYMENT', paidAt: null, bgClearedAt: new Date(), orgMembershipId: MEMBERSHIP_ID,
    });

    await activate(PROCESS_ID, { via: 'certified', actorId: 1 });

    expect(prisma.orgMembershipProcess.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE' }) }),
    );
    expect(notifyBoardPaidReject).not.toHaveBeenCalled();
});
