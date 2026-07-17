/**
 * @jest-environment node
 */
/**
 * Integration tests for GET /api/membership-ops/households (list branch):
 * per-household `renewalGrantable` (the coming-year-button gate) and the
 * top-level `currentMembershipValidUntil` / per-household `orgMembership.memberSince`
 * date fields introduced alongside it.
 */
import { GET } from '@/app/api/membership-ops/households/route';
import prisma from '@/lib/prisma';
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
    let prevBoardSettings: { orgMembershipYearBoundary: Date | null; bgRecheckMonths: number; currentMembershipValidUntil: Date | null } | null = null;

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
            ? { orgMembershipYearBoundary: existing.orgMembershipYearBoundary, bgRecheckMonths: existing.bgRecheckMonths, currentMembershipValidUntil: existing.currentMembershipValidUntil }
            : null;
        await wipe();

        const validUntil = new Date(Date.UTC(2028, 0, 1));
        await prisma.boardSettings.upsert({
            where: { id: 1 },
            create: { id: 1, orgMembershipYearBoundary: new Date(Date.UTC(2000, 11, 25)), bgRecheckMonths: 12, currentMembershipValidUntil: validUntil },
            update: { orgMembershipYearBoundary: new Date(Date.UTC(2000, 11, 25)), bgRecheckMonths: 12, currentMembershipValidUntil: validUntil },
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

    it('response includes top-level currentMembershipValidUntil and per-household orgMembership.memberSince', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });
        const res = await get();
        const data = await res.json();
        expect(data.currentMembershipValidUntil).toEqual(expect.stringMatching(/^2028-01-01/));
        const h = data.households.find((x: { id: number }) => x.id === grantableHouseholdId);
        expect(h.orgMembership.memberSince).toBeTruthy();
    });
});
