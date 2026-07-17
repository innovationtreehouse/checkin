/**
 * @jest-environment node
 */
/**
 * Integration tests for GET /api/membership-ops/households (list branch):
 * per-household `renewalGrantable` (the coming-year-button gate) and the
 * per-household derived `validUntil` (upcoming boundary; +1y when settled) / `orgMembership.memberSince`
 * date fields introduced alongside it.
 */
import { GET } from '@/app/api/membership-ops/households/route';
import prisma from '@/lib/prisma';
import { nextBoundary } from '@/lib/membership/renewal';
import { getServerSession } from 'next-auth/next';

jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));

const TAG = 'households-grantable-test';

function daysAgo(n: number): Date {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - n);
    return d;
}

async function get(url = 'http://localhost:4000/api/membership-ops/households') {
    return GET(new Request(url, { method: 'GET' }) as unknown as import('next/server').NextRequest);
}

describe('GET /api/membership-ops/households — renewalGrantable + dates', () => {
    let adminId: number;
    let prevBoardSettings: { orgMembershipYearBoundary: Date | null; bgRecheckMonths: number } | null = null;

    let notStartedHouseholdId: number;
    let grantableHouseholdId: number;
    let staleBgHouseholdId: number;

    async function wipe() {
        const hhs = await prisma.household.findMany({ where: { name: { contains: TAG } }, select: { id: true } });
        const ids = hhs.map((h) => h.id);
        if (ids.length) {
            const memberships = await prisma.orgMembership.findMany({ where: { householdId: { in: ids } }, select: { id: true } });
            await prisma.orgMembershipProcess.deleteMany({ where: { orgMembershipId: { in: memberships.map((m) => m.id) } } });
            await prisma.orgMembership.deleteMany({ where: { householdId: { in: ids } } });
            await prisma.person.deleteMany({ where: { householdId: { in: ids } } });
            await prisma.household.deleteMany({ where: { id: { in: ids } } });
        }
        await prisma.person.deleteMany({ where: { email: { contains: TAG } } });
    }

    beforeAll(async () => {
        const existing = await prisma.boardSettings.findUnique({ where: { id: 1 } });
        prevBoardSettings = existing
            ? { orgMembershipYearBoundary: existing.orgMembershipYearBoundary, bgRecheckMonths: existing.bgRecheckMonths }
            : null;
        await wipe();

        await prisma.boardSettings.upsert({
            where: { id: 1 },
            create: { id: 1, orgMembershipYearBoundary: new Date(Date.UTC(2000, 11, 25)), bgRecheckMonths: 12 },
            update: { orgMembershipYearBoundary: new Date(Date.UTC(2000, 11, 25)), bgRecheckMonths: 12 },
        });

        adminId = (await prisma.person.create({
            data: { email: `admin-${TAG}@example.com`, name: 'Admin', isSysadmin: true, household: { create: { name: `Admin HH ${TAG}` } } },
        })).id;

        // Button-hidden case: only a PENDING_RENEWAL renewal (member hasn't started).
        const notStarted = await prisma.person.create({
            data: { email: `notstarted-${TAG}@example.com`, name: 'Not Started', isHouseholdLead: true, lastBackgroundCheck: daysAgo(30), household: { create: { name: `Not Started HH ${TAG}` } } },
        });
        notStartedHouseholdId = notStarted.householdId;
        const notStartedMembership = await prisma.orgMembership.create({ data: { householdId: notStartedHouseholdId, status: 'ACTIVE' } });
        await prisma.orgMembershipProcess.create({ data: { orgMembershipId: notStartedMembership.id, kind: 'RENEWAL', status: 'PENDING_RENEWAL' } });

        // Button-shown case: PENDING_PAYMENT + bgClearedAt set + a lead with a fresh check.
        const grantable = await prisma.person.create({
            data: { email: `grantable-${TAG}@example.com`, name: 'Grantable Lead', isHouseholdLead: true, lastBackgroundCheck: daysAgo(30), household: { create: { name: `Grantable HH ${TAG}` } } },
        });
        grantableHouseholdId = grantable.householdId;
        const grantableMembership = await prisma.orgMembership.create({ data: { householdId: grantableHouseholdId, status: 'ACTIVE' } });
        await prisma.orgMembershipProcess.create({ data: { orgMembershipId: grantableMembership.id, kind: 'RENEWAL', status: 'PENDING_PAYMENT', bgClearedAt: new Date() } });

        // Gate-parity case: PENDING_PAYMENT + bgClearedAt set, but the lead's background
        // check is stale (older than the recheck window) — householdBgIsFresh must reject it.
        const staleBg = await prisma.person.create({
            data: { email: `stalebg-${TAG}@example.com`, name: 'Stale Lead', isHouseholdLead: true, lastBackgroundCheck: new Date(Date.UTC(2015, 0, 1)), household: { create: { name: `Stale HH ${TAG}` } } },
        });
        staleBgHouseholdId = staleBg.householdId;
        const staleBgMembership = await prisma.orgMembership.create({ data: { householdId: staleBgHouseholdId, status: 'ACTIVE' } });
        await prisma.orgMembershipProcess.create({ data: { orgMembershipId: staleBgMembership.id, kind: 'RENEWAL', status: 'PENDING_PAYMENT', bgClearedAt: new Date() } });
    });

    afterAll(async () => {
        await wipe();
        if (prevBoardSettings) await prisma.boardSettings.update({ where: { id: 1 }, data: prevBoardSettings });
        await prisma.$disconnect();
    });

    it("renewalGrantable is false for a household whose only renewal is PENDING_RENEWAL (not started)", async () => {
        (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });
        const res = await get();
        expect(res.status).toBe(200);
        const data = await res.json();
        const h = data.households.find((x: { id: number }) => x.id === notStartedHouseholdId);
        expect(h).toBeDefined();
        expect(h.renewalGrantable).toBe(false);
    });

    it('renewalGrantable is true for PENDING_PAYMENT + bgClearedAt + a lead with a fresh background check', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });
        const res = await get();
        const data = await res.json();
        const h = data.households.find((x: { id: number }) => x.id === grantableHouseholdId);
        expect(h).toBeDefined();
        expect(h.renewalGrantable).toBe(true);
    });

    it('renewalGrantable is false for PENDING_PAYMENT + bgClearedAt but a stale lead background check (gate parity)', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });
        const res = await get();
        const data = await res.json();
        const h = data.households.find((x: { id: number }) => x.id === staleBgHouseholdId);
        expect(h).toBeDefined();
        expect(h.renewalGrantable).toBe(false);
    });

    it('derives per-household validUntil from the boundary and includes orgMembership.memberSince', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });
        const res = await get();
        const data = await res.json();
        const h = data.households.find((x: { id: number }) => x.id === grantableHouseholdId);
        // Not settled for the coming year ⇒ valid until the UPCOMING Dec 25 boundary
        // occurrence (membership is exactly one year; nothing stored, nothing to update).
        const expected = nextBoundary(new Date(Date.UTC(2000, 11, 25)), new Date());
        expect(h.validUntil).toEqual(expect.stringMatching(new RegExp(`^${expected.toISOString().slice(0, 10)}`)));
        expect(h.orgMembership.memberSince).toBeTruthy();
    });
});

/**
 * settledForComingYear (membership doc §7.4, fix #4). The route's "handled this
 * cycle" probe now consumes settledThisCycleWhere = kind=RENEWAL, status IN
 * (ACTIVE, ARCHIVED), stageEnteredAt≥windowStart. Requires a boundary that puts
 * `now` inside the renewal window so the probe is live (out of season it matches
 * nothing, and settledForComingYear is trivially false — see the describe above).
 */
describe('GET /api/membership-ops/households — settledForComingYear (fix #4)', () => {
    const TAG4 = 'households-settled-fix4-test';
    let adminId: number;
    let prev: { orgMembershipYearBoundary: Date | null; bgRecheckMonths: number } | null = null;

    // A boundary ~1 month ahead ⇒ windowStart ~1 month ago ⇒ now is in-season and a
    // stageEnteredAt of `now` sits inside the window.
    const boundaryConfig = (() => {
        const b = new Date();
        b.setUTCMonth(b.getUTCMonth() + 1);
        return b;
    })();

    let initialActiveHouseholdId: number; // stray INITIAL activation in-window
    let archivedRenewalHouseholdId: number; // board-archived RENEWAL in-window
    let activeRenewalHouseholdId: number; // finished RENEWAL in-window (control)

    async function wipe() {
        const hhs = await prisma.household.findMany({ where: { name: { contains: TAG4 } }, select: { id: true } });
        const ids = hhs.map((h) => h.id);
        if (ids.length) {
            const memberships = await prisma.orgMembership.findMany({ where: { householdId: { in: ids } }, select: { id: true } });
            await prisma.orgMembershipProcess.deleteMany({ where: { orgMembershipId: { in: memberships.map((m) => m.id) } } });
            await prisma.orgMembership.deleteMany({ where: { householdId: { in: ids } } });
            await prisma.person.deleteMany({ where: { householdId: { in: ids } } });
            await prisma.household.deleteMany({ where: { id: { in: ids } } });
        }
        await prisma.person.deleteMany({ where: { email: { contains: TAG4 } } });
    }

    beforeAll(async () => {
        const existing = await prisma.boardSettings.findUnique({ where: { id: 1 } });
        prev = existing ? { orgMembershipYearBoundary: existing.orgMembershipYearBoundary, bgRecheckMonths: existing.bgRecheckMonths } : null;
        await wipe();
        await prisma.boardSettings.upsert({
            where: { id: 1 },
            create: { id: 1, orgMembershipYearBoundary: boundaryConfig, bgRecheckMonths: 12 },
            update: { orgMembershipYearBoundary: boundaryConfig, bgRecheckMonths: 12 },
        });

        adminId = (await prisma.person.create({
            data: { email: `admin-${TAG4}@example.com`, name: 'Admin', isSysadmin: true, household: { create: { name: `Admin HH ${TAG4}` } } },
        })).id;

        const now = new Date();

        // Stray INITIAL activation stamped in-window: the pre-fix bug counted this as
        // "settled" (any-kind ACTIVE) and flipped validUntil a year forward. Fix #4's
        // kind=RENEWAL filter must now EXCLUDE it.
        const a = await prisma.person.create({
            data: { email: `initial-${TAG4}@example.com`, name: 'Initial Active', isHouseholdLead: true, household: { create: { name: `Initial HH ${TAG4}` } } },
        });
        initialActiveHouseholdId = a.householdId;
        const am = await prisma.orgMembership.create({ data: { householdId: initialActiveHouseholdId, status: 'ACTIVE' } });
        await prisma.orgMembershipProcess.create({ data: { orgMembershipId: am.id, kind: 'INITIAL', status: 'ACTIVE', stageEnteredAt: now } });

        // Board-archived RENEWAL in-window: the pre-fix route missed ARCHIVED; fix #4
        // now counts it as settled.
        const b = await prisma.person.create({
            data: { email: `archived-${TAG4}@example.com`, name: 'Archived Renewal', isHouseholdLead: true, household: { create: { name: `Archived HH ${TAG4}` } } },
        });
        archivedRenewalHouseholdId = b.householdId;
        const bm = await prisma.orgMembership.create({ data: { householdId: archivedRenewalHouseholdId, status: 'ACTIVE' } });
        await prisma.orgMembershipProcess.create({ data: { orgMembershipId: bm.id, kind: 'RENEWAL', status: 'ARCHIVED', stageEnteredAt: now } });

        // Control: a finished RENEWAL (ACTIVE) in-window is settled, as before.
        const c = await prisma.person.create({
            data: { email: `renewalactive-${TAG4}@example.com`, name: 'Active Renewal', isHouseholdLead: true, household: { create: { name: `ActiveRenewal HH ${TAG4}` } } },
        });
        activeRenewalHouseholdId = c.householdId;
        const cm = await prisma.orgMembership.create({ data: { householdId: activeRenewalHouseholdId, status: 'ACTIVE' } });
        await prisma.orgMembershipProcess.create({ data: { orgMembershipId: cm.id, kind: 'RENEWAL', status: 'ACTIVE', stageEnteredAt: now } });
    });

    afterAll(async () => {
        await wipe();
        if (prev) await prisma.boardSettings.update({ where: { id: 1 }, data: prev });
        await prisma.$disconnect();
    });

    async function fetchHouseholds() {
        (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });
        const res = await get();
        expect(res.status).toBe(200);
        const data = await res.json();
        // sanity: we are actually in renewal season (else the probe is trivially empty)
        expect(data.renewalSeason).toBe(true);
        return data.households as { id: number; settledForComingYear: boolean; validUntil: string | null }[];
    }

    it('a stray INITIAL activation in-window is NOT settled (kind=RENEWAL filter)', async () => {
        const households = await fetchHouseholds();
        const h = households.find((x) => x.id === initialActiveHouseholdId);
        expect(h).toBeDefined();
        expect(h!.settledForComingYear).toBe(false);
        // validUntil stays the upcoming boundary — NOT flipped a year forward.
        const expected = nextBoundary(boundaryConfig, new Date());
        expect(h!.validUntil).toEqual(expect.stringMatching(new RegExp(`^${expected.toISOString().slice(0, 10)}`)));
    });

    it('a board-archived RENEWAL in-window IS settled (ARCHIVED counted)', async () => {
        const households = await fetchHouseholds();
        const h = households.find((x) => x.id === archivedRenewalHouseholdId);
        expect(h).toBeDefined();
        expect(h!.settledForComingYear).toBe(true);
        // settled ⇒ validUntil is the boundary a year later.
        const boundary = nextBoundary(boundaryConfig, new Date());
        const plusYear = new Date(Date.UTC(boundary.getUTCFullYear() + 1, boundary.getUTCMonth(), boundary.getUTCDate()));
        expect(h!.validUntil).toEqual(expect.stringMatching(new RegExp(`^${plusYear.toISOString().slice(0, 10)}`)));
    });

    it('a finished RENEWAL (ACTIVE) in-window IS settled (control)', async () => {
        const households = await fetchHouseholds();
        const h = households.find((x) => x.id === activeRenewalHouseholdId);
        expect(h).toBeDefined();
        expect(h!.settledForComingYear).toBe(true);
    });
});
