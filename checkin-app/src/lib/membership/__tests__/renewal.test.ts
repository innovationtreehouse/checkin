/**
 * @jest-environment node
 */
/**
 * Unit tests for renewal.ts edge logic (prisma mocked, no DB):
 *   - householdBgIsFresh: the recheckMonths<=0 short-circuit, and the `gte`
 *     threshold boundary (a check exactly at the threshold counts as fresh).
 *   - beginRenewal: a process not in PENDING_RENEWAL → RenewalError wrong_phase.
 */
import { householdBgIsFresh, beginRenewal, RenewalError } from '@/lib/membership/renewal';

jest.mock('@/lib/prisma', () => ({
    __esModule: true,
    default: {
        person: { findFirst: jest.fn() },
        membershipProcess: { findUnique: jest.fn() },
        membership: { findUnique: jest.fn() },
        boardSettings: { findUnique: jest.fn() },
    },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const prisma = require('@/lib/prisma').default;

// Mirrors the module-private monthsBefore in renewal.ts.
function monthsBefore(date: Date, months: number): Date {
    const d = new Date(date);
    d.setUTCMonth(d.getUTCMonth() - months);
    return d;
}

beforeEach(() => jest.clearAllMocks());

describe('householdBgIsFresh', () => {
    const boundary = new Date(Date.UTC(2026, 8, 1)); // 2026-09-01

    it('recheckMonths = 0 → not fresh, and never queries (policy unset)', async () => {
        // Even a recent check on file must not count when the board hasn't set the policy.
        prisma.person.findFirst.mockResolvedValue({ id: 1 });

        const result = await householdBgIsFresh(42, boundary, 0);

        expect(result).toBe(false);
        expect(prisma.person.findFirst).not.toHaveBeenCalled();
    });

    it('a lead with a check at exactly the threshold → fresh (gte boundary)', async () => {
        prisma.person.findFirst.mockResolvedValue({ id: 1 });

        const result = await householdBgIsFresh(42, boundary, 12);

        expect(result).toBe(true);
        // The boundary is inclusive (gte), and the threshold is boundary - recheckMonths.
        expect(prisma.person.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    householdId: 42,
                    lastBackgroundCheck: { gte: monthsBefore(boundary, 12) },
                }),
            }),
        );
    });

    it('no lead with a fresh-enough check → not fresh', async () => {
        prisma.person.findFirst.mockResolvedValue(null);
        expect(await householdBgIsFresh(42, boundary, 12)).toBe(false);
    });
});

describe('beginRenewal', () => {
    it('throws RenewalError wrong_phase when the process is not PENDING_RENEWAL', async () => {
        prisma.membershipProcess.findUnique.mockResolvedValue({ id: 5, status: 'PENDING_PAYMENT', membershipId: 9 });

        await expect(beginRenewal(5)).rejects.toMatchObject({
            name: 'RenewalError',
            code: 'wrong_phase',
        });
        await expect(beginRenewal(5)).rejects.toBeInstanceOf(RenewalError);
    });

    it('throws RenewalError not_found when the process does not exist', async () => {
        prisma.membershipProcess.findUnique.mockResolvedValue(null);
        await expect(beginRenewal(5)).rejects.toMatchObject({ code: 'not_found' });
    });
});
