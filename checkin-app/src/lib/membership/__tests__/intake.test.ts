/**
 * @jest-environment node
 */
/**
 * Unit test for startIntake's race guard (M3): the check+create now runs inside
 * a transaction holding a FOR UPDATE lock on the Membership row, so a second
 * in-flight INITIAL process is never created — the tx's own re-check (via `tx`,
 * not the caller's stale pre-tx read) finds the winner and returns it. Mirrors
 * renewal's createRenewalProcess / renewalConcurrency.integration.test.ts intent,
 * but as a mocked-prisma unit test since this worktree has no DB.
 */
import { startIntake } from '@/lib/membership/intake';

const txMembershipProcess = { findFirst: jest.fn(), create: jest.fn() };
const txAuditLog = { create: jest.fn() };
const txQueryRaw = jest.fn();
const tx = { $queryRaw: txQueryRaw, membershipProcess: txMembershipProcess, auditLog: txAuditLog };

jest.mock('@/lib/prisma', () => ({
    __esModule: true,
    default: {
        person: { findUnique: jest.fn() },
        membership: { upsert: jest.fn() },
        $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)),
    },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const prisma = require('@/lib/prisma').default;

const user = {
    id: 1,
    householdId: 7,
    isSysadmin: false,
    householdLeads: [{ householdId: 7 }],
    household: { membership: null },
};

beforeEach(() => {
    jest.clearAllMocks();
    prisma.person.findUnique.mockResolvedValue(user);
    prisma.membership.upsert.mockResolvedValue({ id: 42, householdId: 7, status: 'NONE' });
});

describe('startIntake race guard', () => {
    it('a second in-flight INITIAL start (existing found under the lock) returns the existing process, no duplicate create', async () => {
        const existingProcess = { id: 99, membershipId: 42, kind: 'INITIAL', status: 'INTAKE' };
        txMembershipProcess.findFirst.mockResolvedValue(existingProcess);

        const result = await startIntake(1);

        expect(result).toBe(existingProcess);
        // Lock taken before the in-flight check, inside the same transaction.
        expect(txQueryRaw).toHaveBeenCalledTimes(1);
        // No duplicate process/audit row created for the loser of the race.
        expect(txMembershipProcess.create).not.toHaveBeenCalled();
        expect(txAuditLog.create).not.toHaveBeenCalled();
    });

    it('no in-flight process → creates one INTAKE process + audit row inside the same transaction', async () => {
        txMembershipProcess.findFirst.mockResolvedValue(null);
        const created = { id: 100, membershipId: 42, kind: 'INITIAL', status: 'INTAKE' };
        txMembershipProcess.create.mockResolvedValue(created);

        const result = await startIntake(1);

        expect(result).toBe(created);
        expect(txMembershipProcess.create).toHaveBeenCalledWith({
            data: { membershipId: 42, kind: 'INITIAL', status: 'INTAKE' },
        });
        expect(txAuditLog.create).toHaveBeenCalledTimes(1);
    });
});
