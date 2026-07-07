/**
 * @jest-environment node
 */
/**
 * Integration tests for the membership-lapse cascade (design:
 * docs/designs/MEMBERSHIP_LAPSE_CASCADE.md). Drives runLapseCascadeSweep against a
 * real Postgres and the enrollment POST guard, covering the whole arc:
 *   lapse → flag + notify (once, deduped) → grace expiry → auto-withdraw with
 *   hold-ledger +1 (per row, NOT a bulk deleteMany) → renewal clears the flag,
 * plus the check-in/enrollment block (4xx) and the board force-enroll override.
 */
import { runLapseCascadeSweep, householdMembershipLapsed } from '@/lib/membership/lapse';
import { POST } from '@/app/api/programs/[id]/participants/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

// Assert notification dedup by mocking the fan-out helpers.
jest.mock('@/lib/emailRecipients', () => ({
    emailHouseholdLeads: jest.fn(),
    emailBoardMembers: jest.fn(),
}));
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/notifications', () => ({ sendNotification: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { emailHouseholdLeads, emailBoardMembers } = require('@/lib/emailRecipients');

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (d: number) => new Date(Date.now() - d * DAY - DAY / 2);
const TAG = 'lapse-cascade-test';

const params = (id: number) => ({ params: Promise.resolve({ id: String(id) }) }) as unknown as never;
// CHECKIN_ENV=local (set for the Shopify mock) makes authenticateRequest treat a
// COOKIELESS request as a kiosk; a cookie header forces the session path instead.
const enrollReq = (programId: number, body: object) =>
    new Request(`http://localhost/api/programs/${programId}/participants`, {
        method: 'POST', headers: { cookie: 'session=test' }, body: JSON.stringify(body),
    }) as never;

describe('Membership-lapse cascade integration', () => {
    const person: Record<string, number> = {};
    const household: Record<string, number> = {};
    const membership: Record<string, number> = {};
    let programHeld: number;
    let programBlock: number;
    let prevBoundary: Date | null;
    let prevGrace: number | null;
    let prevEnv: string | undefined;

    const mkHousehold = async (key: string, status: 'ACTIVE' | 'REVOKED' | 'DENIED' | 'NONE') => {
        const hh = await prisma.household.create({ data: { name: `${TAG} ${key}` } });
        household[key] = hh.id;
        const m = await prisma.orgMembership.create({ data: { householdId: hh.id, status } });
        membership[key] = m.id;
        return hh.id;
    };
    const mkPerson = async (key: string, householdId: number, lead = false) => {
        const p = await prisma.person.create({
            data: { email: `${key}-${TAG}@example.com`, name: `${key} ${TAG}`, isHouseholdLead: lead, householdId },
        });
        person[key] = p.id;
        return p.id;
    };

    beforeAll(async () => {
        // Clean any leaked state from a prior run.
        const leaked = await prisma.person.findMany({ where: { email: { contains: TAG } }, select: { id: true, householdId: true } });
        const pids = leaked.map((p) => p.id);
        await prisma.programParticipant.deleteMany({ where: { personId: { in: pids } } });
        await prisma.auditLog.deleteMany({ where: { actorId: { in: pids } } });
        await prisma.person.deleteMany({ where: { id: { in: pids } } });
        const oldHh = await prisma.household.findMany({ where: { name: { contains: TAG } }, select: { id: true } });
        const hids = oldHh.map((h) => h.id);
        await prisma.orgMembershipProcess.deleteMany({ where: { orgMembership: { householdId: { in: hids } } } });
        await prisma.orgMembership.deleteMany({ where: { householdId: { in: hids } } });
        await prisma.household.deleteMany({ where: { id: { in: hids } } });
        await prisma.program.deleteMany({ where: { name: { contains: TAG } } });

        prevEnv = process.env.CHECKIN_ENV;
        process.env.CHECKIN_ENV = 'local'; // makes adjustProgramInventory mock-log the +1

        const s = await prisma.boardSettings.findUnique({ where: { id: 1 } });
        prevBoundary = s?.orgMembershipYearBoundary ?? null;
        prevGrace = s?.membershipLapseGraceDays ?? null;
        await prisma.boardSettings.upsert({
            where: { id: 1 },
            create: { id: 1, orgMembershipYearBoundary: new Date(Date.UTC(2020, 0, 1)), membershipLapseGraceDays: 7 },
            update: { orgMembershipYearBoundary: new Date(Date.UTC(2020, 0, 1)), membershipLapseGraceDays: 7 },
        });

        const mkProgram = async (variant: string) =>
            (await prisma.program.create({
                data: {
                    name: `${TAG} ${variant}`, phase: 'UPCOMING', enrollmentStatus: 'OPEN',
                    shopifyVariantId: variant, orgMemberPriceCents: 1000, nonOrgMemberPriceCents: 2000,
                },
            })).id;
        programHeld = await mkProgram('dev-mock-variant-lapse');
        programBlock = await mkProgram('dev-mock-variant-lapse-2');

        // R = REVOKED. rHeld holds a scholarship seat (PENDING + inventoryHeldAt);
        // rPaid is a completed ACTIVE enrollment (must never be auto-withdrawn).
        const rId = await mkHousehold('R', 'REVOKED');
        await mkPerson('rHeld', rId, true);
        await mkPerson('rPaid', rId);
        await prisma.programParticipant.create({ data: { programId: programHeld, personId: person.rHeld, status: 'PENDING', inventoryHeldAt: new Date() } });
        await prisma.programParticipant.create({ data: { programId: programHeld, personId: person.rPaid, status: 'ACTIVE' } });

        // O = ACTIVE but a renewal opened long ago is overdue past the boundary.
        const oId = await mkHousehold('O', 'ACTIVE');
        await mkPerson('oM', oId, true);
        await prisma.orgMembershipProcess.create({ data: { orgMembershipId: membership.O, kind: 'RENEWAL', status: 'PENDING_RENEWAL', createdAt: daysAgo(400) } });
        await prisma.programParticipant.create({ data: { programId: programHeld, personId: person.oM, status: 'PENDING' } });

        // A = healthy ACTIVE member (no in-flight renewal). Control.
        const aId = await mkHousehold('A', 'ACTIVE');
        await mkPerson('aM', aId, true);
        await prisma.programParticipant.create({ data: { programId: programHeld, personId: person.aM, status: 'PENDING' } });

        // N = never a member. Control (its non-member enrollment must be left alone).
        const nId = await mkHousehold('N', 'NONE');
        await mkPerson('nM', nId, true);
        await prisma.programParticipant.create({ data: { programId: programHeld, personId: person.nM, status: 'PENDING' } });

        // Board sysadmin (own household) for the force-enroll override.
        const bId = await mkHousehold('B', 'ACTIVE');
        const b = await prisma.person.create({ data: { email: `bAdmin-${TAG}@example.com`, name: `bAdmin ${TAG}`, isSysadmin: true, householdId: bId } });
        person.bAdmin = b.id;
    });

    afterAll(async () => {
        const pids = Object.values(person);
        const hids = Object.values(household);
        await prisma.programParticipant.deleteMany({ where: { personId: { in: pids } } });
        await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: [...pids, 0] }, tableName: { in: ['ProgramParticipant', 'OrgMembership'] } }] } });
        await prisma.orgMembershipProcess.deleteMany({ where: { orgMembershipId: { in: Object.values(membership) } } });
        await prisma.person.deleteMany({ where: { id: { in: pids } } });
        await prisma.orgMembership.deleteMany({ where: { householdId: { in: hids } } });
        await prisma.household.deleteMany({ where: { id: { in: hids } } });
        await prisma.program.deleteMany({ where: { id: { in: [programHeld, programBlock] } } });
        await prisma.boardSettings.update({ where: { id: 1 }, data: { orgMembershipYearBoundary: prevBoundary, membershipLapseGraceDays: prevGrace } });
        if (prevEnv === undefined) delete process.env.CHECKIN_ENV; else process.env.CHECKIN_ENV = prevEnv;
    });

    const flaggedAt = async (key: string) =>
        (await prisma.orgMembership.findUnique({ where: { id: membership[key] }, select: { lapseFlaggedAt: true } }))?.lapseFlaggedAt ?? null;

    it('flags REVOKED and overdue-ACTIVE households, notifies once, leaves healthy members + non-members alone', async () => {
        jest.clearAllMocks();
        const res = await runLapseCascadeSweep(new Date());

        expect(res.lapsed).toBe(2); // R + O
        expect(res.newlyFlagged).toBe(2);
        expect(await flaggedAt('R')).not.toBeNull();
        expect(await flaggedAt('O')).not.toBeNull();
        expect(await flaggedAt('A')).toBeNull();
        expect(await flaggedAt('N')).toBeNull();

        // One household notice per newly-flagged household, one board digest for the run.
        expect(emailHouseholdLeads).toHaveBeenCalledTimes(2);
        expect(emailBoardMembers).toHaveBeenCalledTimes(1);

        // Nothing withdrawn yet — flagged this run, still inside the 7-day grace.
        expect(res.withdrawn).toBe(0);
        const audit = await prisma.auditLog.findFirst({ where: { tableName: 'OrgMembership', affectedEntityId: membership.R } });
        expect((audit?.newData as { reason?: string })?.reason).toBe('membership_lapsed');
    });

    it('dedups — a second run re-flags nobody and sends no further email', async () => {
        jest.clearAllMocks();
        const before = await flaggedAt('R');
        const res = await runLapseCascadeSweep(new Date());

        expect(res.newlyFlagged).toBe(0);
        expect(emailHouseholdLeads).not.toHaveBeenCalled();
        expect(emailBoardMembers).not.toHaveBeenCalled();
        expect((await flaggedAt('R'))?.getTime()).toBe(before?.getTime()); // stamp untouched
    });

    it('auto-withdraws PENDING enrollments past grace, releasing each hold +1 per row (not a bulk deleteMany), sparing ACTIVE rows', async () => {
        // Age R's flag past the 7-day grace window.
        await prisma.orgMembership.update({ where: { id: membership.R }, data: { lapseFlaggedAt: daysAgo(10) } });
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.clearAllMocks();
        try {
            const res = await runLapseCascadeSweep(new Date());
            expect(res.withdrawn).toBe(1); // only rHeld's PENDING row

            // rHeld's held PENDING row: gone, and its seat released +1 (per-row, via
            // withdrawAndReleaseHold — a bulk deleteMany would emit ZERO of these).
            const held = await prisma.programParticipant.findUnique({ where: { programId_personId: { programId: programHeld, personId: person.rHeld } } });
            expect(held).toBeNull();
            const releaseLogs = logSpy.mock.calls.filter((c) => String(c[0]).includes('Would adjust inventory by 1 for variants: dev-mock-variant-lapse'));
            expect(releaseLogs).toHaveLength(1);

            // Per-row audit (a deleteMany produces none).
            const audit = await prisma.auditLog.findFirst({ where: { tableName: 'ProgramParticipant', affectedEntityId: person.rHeld, secondaryAffectedEntity: programHeld } });
            expect((audit?.newData as { reason?: string })?.reason).toBe('membership_lapse_withdrawn');

            // rPaid's ACTIVE (paid) row is spared.
            const paid = await prisma.programParticipant.findUnique({ where: { programId_personId: { programId: programHeld, personId: person.rPaid } } });
            expect(paid?.status).toBe('ACTIVE');
            // O flagged this-run-ago (not past grace) — its pending row untouched.
            const oRow = await prisma.programParticipant.findUnique({ where: { programId_personId: { programId: programHeld, personId: person.oM } } });
            expect(oRow).not.toBeNull();
        } finally {
            logSpy.mockRestore();
        }
    });

    it('renewal before the deadline clears the flag and blocks nothing further', async () => {
        // O completes its renewal → the incomplete RENEWAL process leaves the open set.
        await prisma.orgMembershipProcess.updateMany({ where: { orgMembershipId: membership.O, kind: 'RENEWAL' }, data: { status: 'ACTIVE' } });
        const res = await runLapseCascadeSweep(new Date());

        expect(res.cleared).toBeGreaterThanOrEqual(1);
        expect(await flaggedAt('O')).toBeNull();
        expect(await householdMembershipLapsed(household.O)).toBe(false);
        const cleared = await prisma.auditLog.findFirst({ where: { tableName: 'OrgMembership', affectedEntityId: membership.O, newData: { path: ['reason'], equals: 'membership_lapse_cleared' } } });
        expect(cleared).not.toBeNull();
    });

    it('householdMembershipLapsed gates lapsed vs healthy households (the shared check-in/enrollment guard)', async () => {
        expect(await householdMembershipLapsed(household.R)).toBe(true);  // REVOKED
        expect(await householdMembershipLapsed(household.A)).toBe(false); // healthy ACTIVE
        expect(await householdMembershipLapsed(household.N)).toBe(false); // never a member
    });

    describe('enrollment block (4xx) + board override', () => {
        it('403s a lapsed household member self-enrolling in a new program', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: person.rHeld } });
            const res = await POST(enrollReq(programBlock, { participantId: person.rHeld }), params(programBlock));
            expect(res.status).toBe(403);
            expect((await res.json()).error).toMatch(/membership has lapsed/i);
        });

        it('lets a healthy member enroll (control)', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: person.aM } });
            const res = await POST(enrollReq(programBlock, { participantId: person.aM }), params(programBlock));
            expect(res.status).toBe(200);
        });

        it('still lets a board member force-enroll a lapsed member (override bypasses the block)', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: person.bAdmin, isSysadmin: true } });
            const res = await POST(enrollReq(programBlock, { participantId: person.rHeld, override: true }), params(programBlock));
            expect(res.status).toBe(200);
            expect((await res.json()).success).toBe(true);
        });
    });
});
