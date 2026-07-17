/**
 * @jest-environment node
 */
/**
 * Unit tests for the membership-duration guard added to lib/orgMembership.ts:
 *   - membershipValidThrough: a household's covered-through boundary — the
 *     upcoming membership-year boundary, or one boundary further once the
 *     household is settled for the coming year (same probe as the
 *     households-ops list's settledForComingYear).
 *   - isActiveOrgMemberThrough: does a person's membership cover a program
 *     running through a given date.
 *   - programCoverageDate: the date a program's member pricing must be valid
 *     through (endAt, else startAt, else null).
 * Prisma mocked — no DB. nextBoundary/renewalSeasonWindow run for real (from
 * @/lib/membership/renewal) so the boundary arithmetic is exercised, not stubbed.
 */
import { membershipValidThrough, isActiveOrgMemberThrough, programCoverageDate } from '@/lib/orgMembership';
import { nextBoundary } from '@/lib/membership/renewal';

jest.mock('@/lib/prisma', () => ({
    __esModule: true,
    default: {
        household: { findUnique: jest.fn() },
        boardSettings: { findUnique: jest.fn() },
        orgMembershipProcess: { findFirst: jest.fn() },
        person: { findFirst: jest.fn(), findUnique: jest.fn() },
    },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const prisma = require('@/lib/prisma').default;

const BOUNDARY = new Date(Date.UTC(2000, 11, 25)); // Dec 25 — mirrors the repo's other boundary tests

beforeEach(() => jest.clearAllMocks());

describe('membershipValidThrough', () => {
    it('ACTIVE + boundary configured, not settled → the upcoming boundary occurrence', async () => {
        prisma.household.findUnique.mockResolvedValue({ orgMembership: { id: 7, status: 'ACTIVE' } });
        prisma.boardSettings.findUnique.mockResolvedValue({ orgMembershipYearBoundary: BOUNDARY });
        prisma.orgMembershipProcess.findFirst.mockResolvedValue(null); // not settled

        const now = new Date(Date.UTC(2026, 0, 1));
        const result = await membershipValidThrough(1, now);
        expect(result).toEqual(nextBoundary(BOUNDARY, now));
    });

    it('settled for the coming year → one year past the upcoming boundary', async () => {
        prisma.household.findUnique.mockResolvedValue({ orgMembership: { id: 7, status: 'ACTIVE' } });
        prisma.boardSettings.findUnique.mockResolvedValue({ orgMembershipYearBoundary: BOUNDARY });
        prisma.orgMembershipProcess.findFirst.mockResolvedValue({ id: 99 }); // settled

        const now = new Date(Date.UTC(2026, 0, 1));
        const result = await membershipValidThrough(1, now);
        const boundary = nextBoundary(BOUNDARY, now);
        expect(result).toEqual(new Date(Date.UTC(boundary.getUTCFullYear() + 1, boundary.getUTCMonth(), boundary.getUTCDate())));
    });

    it('not ACTIVE → null', async () => {
        prisma.household.findUnique.mockResolvedValue({ orgMembership: { id: 7, status: 'REVOKED' } });
        const result = await membershipValidThrough(1, new Date());
        expect(result).toBeNull();
        expect(prisma.boardSettings.findUnique).not.toHaveBeenCalled();
    });

    it('no boundary configured → null', async () => {
        prisma.household.findUnique.mockResolvedValue({ orgMembership: { id: 7, status: 'ACTIVE' } });
        prisma.boardSettings.findUnique.mockResolvedValue({ orgMembershipYearBoundary: null });
        const result = await membershipValidThrough(1, new Date());
        expect(result).toBeNull();
    });
});

describe('isActiveOrgMemberThrough', () => {
    it('not an active member → false, regardless of through', async () => {
        prisma.person.findFirst.mockResolvedValue(null); // isActiveOrgMember: no match
        const result = await isActiveOrgMemberThrough(1, new Date());
        expect(result).toBe(false);
    });

    it('through === null → true (status-only, no program dates)', async () => {
        prisma.person.findFirst.mockResolvedValue({ id: 1 }); // active member
        const result = await isActiveOrgMemberThrough(1, null);
        expect(result).toBe(true);
    });

    it('ACTIVE + no boundary configured → true (cannot compute a horizon)', async () => {
        prisma.person.findFirst.mockResolvedValue({ id: 1 });
        prisma.person.findUnique.mockResolvedValue({ householdId: 5 });
        prisma.household.findUnique.mockResolvedValue({ orgMembership: { id: 7, status: 'ACTIVE' } });
        prisma.boardSettings.findUnique.mockResolvedValue({ orgMembershipYearBoundary: null });

        const result = await isActiveOrgMemberThrough(1, new Date(Date.UTC(2030, 0, 1)));
        expect(result).toBe(true);
    });

    it('a through-date on the valid-through day → true', async () => {
        prisma.person.findFirst.mockResolvedValue({ id: 1 });
        prisma.person.findUnique.mockResolvedValue({ householdId: 5 });
        prisma.household.findUnique.mockResolvedValue({ orgMembership: { id: 7, status: 'ACTIVE' } });
        prisma.boardSettings.findUnique.mockResolvedValue({ orgMembershipYearBoundary: BOUNDARY });
        prisma.orgMembershipProcess.findFirst.mockResolvedValue(null);

        const boundary = nextBoundary(BOUNDARY, new Date());
        const result = await isActiveOrgMemberThrough(1, boundary);
        expect(result).toBe(true);
    });

    it('a through-date after the valid-through day → false', async () => {
        prisma.person.findFirst.mockResolvedValue({ id: 1 });
        prisma.person.findUnique.mockResolvedValue({ householdId: 5 });
        prisma.household.findUnique.mockResolvedValue({ orgMembership: { id: 7, status: 'ACTIVE' } });
        prisma.boardSettings.findUnique.mockResolvedValue({ orgMembershipYearBoundary: BOUNDARY });
        prisma.orgMembershipProcess.findFirst.mockResolvedValue(null);

        const boundary = nextBoundary(BOUNDARY, new Date());
        const dayAfter = new Date(Date.UTC(boundary.getUTCFullYear(), boundary.getUTCMonth(), boundary.getUTCDate() + 1));
        const result = await isActiveOrgMemberThrough(1, dayAfter);
        expect(result).toBe(false);
    });
});

describe('programCoverageDate', () => {
    it('endAt wins when both are set', () => {
        const startAt = new Date('2026-01-01');
        const endAt = new Date('2026-06-01');
        expect(programCoverageDate({ startAt, endAt })).toBe(endAt);
    });

    it('falls back to startAt when endAt is null', () => {
        const startAt = new Date('2026-01-01');
        expect(programCoverageDate({ startAt, endAt: null })).toBe(startAt);
    });

    it('both null → null', () => {
        expect(programCoverageDate({ startAt: null, endAt: null })).toBeNull();
    });
});
