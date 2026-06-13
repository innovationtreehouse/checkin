/**
 * @jest-environment node
 */
/**
 * Integration tests for renewal: the cron sweep, beginRenewal (3-yr BG rule),
 * and the renewal background-review path reusing the 2-of-N flow.
 */

import { GET as CRON } from '@/app/api/cron/membership-renewals/route';
import { runRenewalSweep, beginRenewal, nextBoundary } from '@/lib/membership/renewal';
import { attest } from '@/lib/membership/review';
import prisma from '@/lib/prisma';

jest.mock('@/lib/email', () => ({ sendEmail: jest.fn().mockResolvedValue(true) }));

const TAG = 'renewal-test';
const CRON_SECRET = 'cron-test-secret';

function cronReq(token: string | null) {
    return new Request('http://localhost:4000/api/cron/membership-renewals', {
        headers: token ? { authorization: `Bearer ${token}` } : {},
    });
}

describe('Membership renewal', () => {
    const prevSecret = process.env.CRON_SECRET;
    let prevBoundary: Date | null = null;
    let rev1: number, rev2: number;
    // The sweep is global; track where we started so afterAll can remove every
    // process this test opened (including renewals on other suites' memberships).
    let preMaxProcessId = 0;

    async function makeActiveMembership(label: string, parentBg: Date | null) {
        const hh = await prisma.household.create({ data: { name: `${label} ${TAG}` } });
        // The guardian is a household lead (drives the 3-yr BG-freshness check).
        const parent = await prisma.participant.create({ data: { name: `${label} Parent`, householdId: hh.id, lastBackgroundCheck: parentBg ?? undefined } });
        await prisma.householdLead.create({ data: { householdId: hh.id, participantId: parent.id } });
        const m = await prisma.membership.create({ data: { householdId: hh.id, status: 'ACTIVE' } });
        return { householdId: hh.id, membershipId: m.id };
    }

    async function wipe() {
        const hhs = await prisma.household.findMany({ where: { OR: [{ name: { contains: TAG } }, { participants: { some: { email: { contains: TAG } } } }] }, select: { id: true } });
        const ids = hhs.map((h) => h.id);
        if (ids.length) {
            await prisma.backgroundCheckAttestation.deleteMany({ where: { process: { membership: { householdId: { in: ids } } } } });
            await prisma.membershipProcess.deleteMany({ where: { membership: { householdId: { in: ids } } } });
            await prisma.membership.deleteMany({ where: { householdId: { in: ids } } });
            await prisma.householdLead.deleteMany({ where: { householdId: { in: ids } } });
            await prisma.participant.deleteMany({ where: { householdId: { in: ids } } });
            await prisma.household.deleteMany({ where: { id: { in: ids } } });
        }
        await prisma.participant.deleteMany({ where: { email: { contains: TAG } } });
    }

    // A real Treehouse-style interval (~2.6yr) so the BG-freshness rule has a configured value.
    const BG_RECHECK_MONTHS = 31;

    async function setBoundary(date: Date | null) {
        await prisma.boardSettings.upsert({
            where: { id: 1 },
            create: { id: 1, normalDuesCents: 0, volunteerDuesCents: 0, membershipYearBoundary: date, bgRecheckMonths: BG_RECHECK_MONTHS },
            update: { membershipYearBoundary: date, bgRecheckMonths: BG_RECHECK_MONTHS },
        });
    }

    beforeAll(async () => {
        process.env.CRON_SECRET = CRON_SECRET;
        const maxRow = await prisma.membershipProcess.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
        preMaxProcessId = maxRow?.id ?? 0;
        const existing = await prisma.boardSettings.findUnique({ where: { id: 1 } });
        prevBoundary = existing?.membershipYearBoundary ?? null;
        await wipe();
        const r1 = await prisma.participant.create({ data: { email: `rev1-${TAG}@example.com`, name: 'Rev1', backgroundCheckReviewer: true, household: { create: { name: `Rev1 HH ${TAG}` } } } });
        rev1 = r1.id;
        rev2 = (await prisma.participant.create({ data: { email: `rev2-${TAG}@example.com`, name: 'Rev2', backgroundCheckReviewer: true, household: { create: { name: `Rev2 HH ${TAG}` } } } })).id;
    });

    afterAll(async () => {
        // Remove every process (and its attestations) this test's global sweeps opened.
        await prisma.backgroundCheckAttestation.deleteMany({ where: { processId: { gt: preMaxProcessId } } });
        await prisma.membershipProcess.deleteMany({ where: { id: { gt: preMaxProcessId } } });
        await wipe();
        await setBoundary(prevBoundary);
        if (prevSecret === undefined) delete process.env.CRON_SECRET;
        else process.env.CRON_SECRET = prevSecret;
        await prisma.$disconnect();
    });

    it('cron rejects missing/invalid bearer', async () => {
        expect((await CRON(cronReq(null))).status).toBe(401);
        expect((await CRON(cronReq('wrong'))).status).toBe(401);
    });

    it('nextBoundary rolls to next year when the date has passed', () => {
        const boundary = new Date(Date.UTC(2020, 7, 1)); // Aug 1
        const now = new Date(Date.UTC(2026, 8, 15)); // Sep 15 2026 (past Aug 1)
        expect(nextBoundary(boundary, now).getUTCFullYear()).toBe(2027);
    });

    it('does nothing outside the renewal window', async () => {
        await setBoundary(new Date(Date.UTC(2000, 7, 1))); // Aug 1
        const res = await runRenewalSweep(new Date(Date.UTC(2026, 0, 1))); // Jan — far from Aug
        expect(res.opened).toBe(0);
    });

    it('opens a PENDING_RENEWAL process within the window, once', async () => {
        await setBoundary(new Date(Date.UTC(2000, 7, 1))); // Aug 1
        const m = await makeActiveMembership('Due', null);
        const now = new Date(Date.UTC(2026, 6, 1)); // Jul 1 — within 2 months before Aug 1

        const first = await runRenewalSweep(now);
        expect(first.opened).toBeGreaterThanOrEqual(1);
        const proc = await prisma.membershipProcess.findFirst({ where: { membershipId: m.membershipId } });
        expect(proc?.status).toBe('PENDING_RENEWAL');
        expect(proc?.kind).toBe('RENEWAL');

        const second = await runRenewalSweep(now);
        const count = await prisma.membershipProcess.count({ where: { membershipId: m.membershipId } });
        expect(count).toBe(1); // not duplicated
        expect(second).toBeDefined();
    });

    it('beginRenewal goes straight to payment when a parent BG is fresh', async () => {
        await setBoundary(new Date(Date.UTC(2000, 7, 1)));
        const m = await makeActiveMembership('Fresh', new Date()); // recent BG
        const proc = await prisma.membershipProcess.create({ data: { membershipId: m.membershipId, kind: 'RENEWAL', status: 'PENDING_RENEWAL' } });
        const out = await beginRenewal(proc.id);
        expect(out.status).toBe('PENDING_PAYMENT');
    });

    it('beginRenewal requires re-review when BG is stale', async () => {
        await setBoundary(new Date(Date.UTC(2000, 7, 1)));
        const m = await makeActiveMembership('Stale', null); // no BG on record
        const proc = await prisma.membershipProcess.create({ data: { membershipId: m.membershipId, kind: 'RENEWAL', status: 'PENDING_RENEWAL' } });
        const out = await beginRenewal(proc.id);
        expect(out.status).toBe('RENEWAL_PENDING_BG');

        // The 2-of-N review flow handles renewal BG too: 2 approvals -> PENDING_PAYMENT.
        await attest(rev1, proc.id, { result: 'APPROVE' });
        const final = await attest(rev2, proc.id, { result: 'APPROVE' });
        expect(final.status).toBe('PENDING_PAYMENT');
    });

    it('cron runs with a valid bearer', async () => {
        // Far-future boundary so the real-time sweep is a no-op (no global pollution).
        await setBoundary(new Date(Date.now() + 150 * 24 * 3600 * 1000));
        const res = await CRON(cronReq(CRON_SECRET));
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
    });
});
