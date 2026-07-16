/**
 * @jest-environment node
 */
/**
 * Unit tests for renewal.ts edge logic (prisma mocked, no DB):
 *   - householdBgIsFresh: the recheckMonths<=0 short-circuit, and the `gte`
 *     threshold boundary (a check exactly at the threshold counts as fresh).
 *   - beginRenewal: a process not in PENDING_RENEWAL → RenewalError wrong_phase;
 *     the fresh-check path stamps bgClearedAt AND matches the volunteer
 *     allowlist at its PENDING_PAYMENT transition (#874).
 */
import { householdBgIsFresh, beginRenewal, RenewalError } from '@/lib/membership/renewal';

jest.mock('@/lib/prisma', () => ({
    __esModule: true,
    default: {
        person: { findFirst: jest.fn() },
        orgMembershipProcess: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), updateMany: jest.fn() },
        orgMembership: { findUnique: jest.fn() },
        boardSettings: { findUnique: jest.fn() },
        auditLog: { create: jest.fn() },
    },
}));

jest.mock('@/lib/membership/review', () => ({
    notifyReviewers: jest.fn().mockResolvedValue(undefined),
    applyVolunteerStatus: jest.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const prisma = require('@/lib/prisma').default;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { notifyReviewers, applyVolunteerStatus } = require('@/lib/membership/review');

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
        prisma.orgMembershipProcess.findUnique.mockResolvedValue({ id: 5, status: 'PENDING_PAYMENT', orgMembershipId: 9 });

        await expect(beginRenewal(5)).rejects.toMatchObject({
            name: 'RenewalError',
            code: 'wrong_phase',
        });
        await expect(beginRenewal(5)).rejects.toBeInstanceOf(RenewalError);
    });

    it('throws RenewalError not_found when the process does not exist', async () => {
        prisma.orgMembershipProcess.findUnique.mockResolvedValue(null);
        await expect(beginRenewal(5)).rejects.toMatchObject({ code: 'not_found' });
    });

    describe('from PENDING_RENEWAL', () => {
        const pending = { id: 5, status: 'PENDING_RENEWAL', orgMembershipId: 9 };

        beforeEach(() => {
            prisma.orgMembershipProcess.findUnique.mockResolvedValue(pending);
            prisma.orgMembership.findUnique.mockResolvedValue({ householdId: 7, household: { intakeNotes: null } });
            prisma.boardSettings.findUnique.mockResolvedValue({ orgMembershipYearBoundary: new Date(Date.UTC(2026, 8, 1)), bgRecheckMonths: 12 });
            prisma.orgMembershipProcess.updateMany.mockResolvedValue({ count: 1 });
            prisma.orgMembershipProcess.findUniqueOrThrow.mockResolvedValue({ ...pending, status: 'PENDING_PAYMENT' });
        });

        it('fresh check → PENDING_PAYMENT + bgClearedAt + volunteer allowlist matched (#874), no reviewer ping', async () => {
            prisma.person.findFirst.mockResolvedValue({ id: 1 }); // a lead with a valid check

            await beginRenewal(5);

            expect(prisma.orgMembershipProcess.updateMany).toHaveBeenCalledWith({
                where: { id: 5, status: 'PENDING_RENEWAL' },
                data: expect.objectContaining({ status: 'PENDING_PAYMENT', bgClearedAt: expect.any(Date) }),
            });
            // Fresh-check renewals skip clearBackgroundCheck, so a designation added
            // since last cycle must be matched here or the household pays full dues.
            expect(applyVolunteerStatus).toHaveBeenCalledWith(prisma, 9, 7, false);
            expect(notifyReviewers).not.toHaveBeenCalled();
        });

        it('stale check → PENDING_EXTERNAL_ACTION (the request flow), no ping — reviewers wait for consent', async () => {
            prisma.person.findFirst.mockResolvedValue(null); // no valid check on file
            prisma.orgMembershipProcess.findUniqueOrThrow.mockResolvedValue({ ...pending, status: 'PENDING_EXTERNAL_ACTION' });

            await beginRenewal(5);

            expect(prisma.orgMembershipProcess.updateMany).toHaveBeenCalledWith({
                where: { id: 5, status: 'PENDING_RENEWAL' },
                data: expect.objectContaining({ status: 'PENDING_EXTERNAL_ACTION' }),
            });
            expect(prisma.orgMembershipProcess.updateMany).toHaveBeenCalledWith({
                where: { id: 5, status: 'PENDING_RENEWAL' },
                data: expect.not.objectContaining({ bgClearedAt: expect.anything() }),
            });
            expect(applyVolunteerStatus).not.toHaveBeenCalled();
            // Nothing to review until the member consents on Averity — the
            // advance (advanceExternalIfComplete) pings, same as INITIAL.
            expect(notifyReviewers).not.toHaveBeenCalled();
        });

        it('fresh check + household intake note → PENDING_BG_REVIEW: the note must reach a reviewer before payment (#907)', async () => {
            prisma.person.findFirst.mockResolvedValue({ id: 1 }); // a lead with a valid check
            prisma.orgMembership.findUnique.mockResolvedValue({ householdId: 7, household: { intakeNotes: 'treat us as a volunteer household' } });
            prisma.orgMembershipProcess.findUniqueOrThrow.mockResolvedValue({ ...pending, status: 'PENDING_BG_REVIEW' });

            await beginRenewal(5);

            expect(prisma.orgMembershipProcess.updateMany).toHaveBeenCalledWith({
                where: { id: 5, status: 'PENDING_RENEWAL' },
                // No bgClearedAt despite the fresh check: the review queue only
                // lists uncleared rows, so clearing here would strand the note.
                data: expect.not.objectContaining({ bgClearedAt: expect.anything() }),
            });
            expect(prisma.orgMembershipProcess.updateMany).toHaveBeenCalledWith({
                where: { id: 5, status: 'PENDING_RENEWAL' },
                data: expect.objectContaining({ status: 'PENDING_BG_REVIEW' }),
            });
            expect(applyVolunteerStatus).not.toHaveBeenCalled(); // clearBackgroundCheck applies it after the review
            expect(notifyReviewers).toHaveBeenCalledTimes(1); // the note is reviewable immediately
        });

        it('double-submit loser (count 0) → no audit, no allowlist match, no ping', async () => {
            prisma.person.findFirst.mockResolvedValue({ id: 1 });
            prisma.orgMembershipProcess.updateMany.mockResolvedValue({ count: 0 });

            await beginRenewal(5);

            expect(prisma.auditLog.create).not.toHaveBeenCalled();
            expect(applyVolunteerStatus).not.toHaveBeenCalled();
            expect(notifyReviewers).not.toHaveBeenCalled();
        });
    });
});
