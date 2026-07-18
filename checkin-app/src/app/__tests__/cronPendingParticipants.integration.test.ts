/**
 * @jest-environment node
 */
/**
 * Integration Tests for Cron Pending-Participants API
 * Tests GET /api/cron/pending-participants — the DESTRUCTIVE sweep that deletes
 * unpaid PENDING enrollments after a 7-day window and warns at day 1/3/6.
 *
 * The route reads `pendingSince` and computes diffDays = floor((now - pendingSince)/day).
 * We seed enrollments with controlled pendingSince so each boundary is hit:
 *   day 1/3/6  -> warned, NOT deleted
 *   day 7      -> deleted
 * isPaymentPlanRequested:true rows are filtered out of the query entirely and
 * therefore survive forever.
 */

import { GET } from '@/app/api/cron/pending-participants/route';
import prisma from '@/lib/prisma';

jest.mock('@/lib/email');
// `@/lib/email`'s real module has no __getSentEmails/__clearSentEmails — those
// only exist on the manual mock (src/lib/__mocks__/email.ts) that jest.mock
// above swaps in. jest.requireMock (not a direct import) fetches that swapped
// instance so this typechecks against the mock's own shape.
const { __getSentEmails, __clearSentEmails } =
    jest.requireMock<typeof import('@/lib/__mocks__/email')>('@/lib/email');

const DAY_MS = 24 * 60 * 60 * 1000;
// Half-day offset puts each row safely inside its target day so floor() is stable.
const daysAgo = (now: number, d: number) => new Date(now - d * DAY_MS - DAY_MS / 2);

describe('Cron Pending-Participants API Integration Tests', () => {
    let programId: number;
    const ids: Record<string, number> = {};

    const mkParticipant = async (key: string) => {
        const p = await prisma.person.create({
            data: { email: `${key}-pending-cron-test@example.com`, name: `${key} Pending Cron`, household: { create: { name: "Test HH" } } }
        });
        ids[key] = p.id;
        return p.id;
    };

    beforeAll(async () => {
        // Clean up any leaked state
        const leaked = await prisma.person.findMany({
            where: { email: { contains: 'pending-cron-test' } },
            select: { id: true }
        });
        const leakedIds = leaked.map(u => u.id);
        await prisma.programParticipant.deleteMany({ where: { personId: { in: leakedIds } } });
        await prisma.person.deleteMany({ where: { id: { in: leakedIds } } });
        await prisma.program.deleteMany({ where: { name: { contains: 'Pending Cron Test' } } });

        const program = await prisma.program.create({
            data: { name: 'Pending Cron Test Program', phase: 'UPCOMING', enrollmentStatus: 'OPEN' }
        });
        programId = program.id;

        const now = Date.now();
        await mkParticipant('day1');
        await mkParticipant('day3');
        await mkParticipant('day6');
        await mkParticipant('day7');
        await mkParticipant('plan'); // PENDING_HELD (req=true, seat held) -> never swept
        await mkParticipant('holdFailed'); // PENDING_HOLD_FAILED (req=true, held=null) -> also never swept
        await mkParticipant('denied'); // denied applicant -> grace-expiry cron's job, never this sweep's

        await prisma.programParticipant.createMany({
            data: [
                { programId, personId: ids.day1, status: 'PENDING', pendingSince: daysAgo(now, 1) },
                { programId, personId: ids.day3, status: 'PENDING', pendingSince: daysAgo(now, 3) },
                { programId, personId: ids.day6, status: 'PENDING', pendingSince: daysAgo(now, 6) },
                { programId, personId: ids.day7, status: 'PENDING', pendingSince: daysAgo(now, 7) },
                // A genuine held request stamps inventoryHeldAt (that's what the apply-time -1 does).
                { programId, personId: ids.plan, status: 'PENDING', pendingSince: daysAgo(now, 8), isPaymentPlanRequested: true, inventoryHeldAt: daysAgo(now, 8) },
                // PENDING_HOLD_FAILED: the apply-time -1 failed, so req=true but no seat is held.
                // isPaymentPlanRequested=true still excludes it from the sweep — it is the board's
                // problem (Shopify reconciliation queue), NEVER the applicant's, so it must survive.
                { programId, personId: ids.holdFailed, status: 'PENDING', pendingSince: daysAgo(now, 9), isPaymentPlanRequested: true, inventoryHeldAt: null },
                // Denied 10 days after enrolling: pendingSince is way past the 7-day
                // kick, but paymentPlanDeniedAt hands the timeline to scholarship-grace-expiry.
                { programId, personId: ids.denied, status: 'PENDING', pendingSince: daysAgo(now, 10), isPaymentPlanRequested: false, paymentPlanDeniedAt: daysAgo(now, 0), inventoryHeldAt: daysAgo(now, 10) },
            ]
        });
    });

    afterAll(async () => {
        const idList = Object.values(ids);
        await prisma.programParticipant.deleteMany({ where: { programId } });
        await prisma.person.deleteMany({ where: { id: { in: idList } } });
        await prisma.program.deleteMany({ where: { id: programId } });
    });

    const mkReq = (auth?: string) => new Request('http://localhost:4000/api/cron/pending-participants', {
        method: 'GET',
        headers: auth ? { authorization: auth } : {}
    }) as unknown as Request;

    beforeEach(() => __clearSentEmails());

    describe('auth', () => {
        it('returns 401 when the Authorization header is missing', async () => {
            process.env.CRON_SECRET = 'test-secret';
            const res = await GET(mkReq());
            expect(res.status).toBe(401);
        });

        it('returns 401 when the cron secret is wrong', async () => {
            process.env.CRON_SECRET = 'test-secret';
            const res = await GET(mkReq('Bearer wrong-secret'));
            expect(res.status).toBe(401);
        });
    });

    describe('sweep at diffDays boundaries', () => {
        it('warns at days 1/3/6, deletes at day 7, and never touches payment-plan rows', async () => {
            process.env.CRON_SECRET = 'test-secret';
            const res = await GET(mkReq('Bearer test-secret'));
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.success).toBe(true);
            // day1, day3, day6, day7 are PENDING + no payment plan -> processed.
            expect(data.processed).toBe(4);
            // day1, day3, day6 warned; day7 kicked.
            expect(data.warned).toBe(3);
            expect(data.kicked).toBe(1);

            // DB reality: only day7 deleted; the warned rows, both payment-plan rows
            // (held AND hold-failed), and the denied-applicant row (grace-expiry cron's
            // responsibility) survive.
            const survivors = await prisma.programParticipant.findMany({ where: { programId } });
            const survivorPids = survivors.map(s => s.personId).sort((a, b) => a - b);
            expect(survivorPids).toEqual([ids.day1, ids.day3, ids.day6, ids.plan, ids.holdFailed, ids.denied].sort((a, b) => a - b));

            const day7 = await prisma.programParticipant.findUnique({
                where: { programId_personId: { programId, personId: ids.day7 } }
            });
            expect(day7).toBeNull();
        });
    });

    describe('email dispatch', () => {
        // Own program (distinct name -> distinct subject text) so assertions here
        // can't be confused by the outer describe's day1/3/6 rows, which survive
        // and get re-warned every time GET runs later in the file.
        let emailProgramId: number;
        let householdAId: number;
        let householdBId: number;
        const eids: Record<string, number> = {};

        beforeAll(async () => {
            const leaked = await prisma.person.findMany({
                where: { email: { contains: 'pending-cron-email-test' } },
                select: { id: true }
            });
            const leakedIds = leaked.map(u => u.id);
            await prisma.programParticipant.deleteMany({ where: { personId: { in: leakedIds } } });
            await prisma.person.deleteMany({ where: { id: { in: leakedIds } } });
            await prisma.program.deleteMany({ where: { name: 'Pending Cron Email Test Program' } });

            const program = await prisma.program.create({
                data: { name: 'Pending Cron Email Test Program', phase: 'UPCOMING', enrollmentStatus: 'OPEN' }
            });
            emailProgramId = program.id;

            // Household A: a lead + a child (both have email) -> day-6 FINAL WARNING
            // must reach both the lead's address and the participant's own address.
            const householdA = await prisma.household.create({ data: { name: 'Email Test HH A' } });
            householdAId = householdA.id;
            const leadA = await prisma.person.create({
                data: { email: 'leadA-pending-cron-email-test@example.com', name: 'Lead A', householdId: householdAId, isHouseholdLead: true }
            });
            const day6Child = await prisma.person.create({
                data: { email: 'day6child-pending-cron-email-test@example.com', name: 'Day6 Child', householdId: householdAId }
            });
            eids.leadA = leadA.id;
            eids.day6Child = day6Child.id;

            // Household B: a lead (has email) + a child with NO email -> only the lead
            // should be resolved; the child drops out silently, nothing errors.
            const householdB = await prisma.household.create({ data: { name: 'Email Test HH B' } });
            householdBId = householdB.id;
            const leadB = await prisma.person.create({
                data: { email: 'leadB-pending-cron-email-test@example.com', name: 'Lead B', householdId: householdBId, isHouseholdLead: true }
            });
            const noEmailChild = await prisma.person.create({
                data: { email: null, name: 'No Email Child', householdId: householdBId }
            });
            eids.leadB = leadB.id;
            eids.noEmailChild = noEmailChild.id;

            // Day-7 candidate that the sweep actually removes -> exactly one removal email.
            const day7Valid = await prisma.person.create({
                data: { email: 'day7valid-pending-cron-email-test@example.com', name: 'Day7 Valid', household: { create: { name: 'Email Test HH C' } } }
            });
            eids.day7Valid = day7Valid.id;

            // Day-7 candidate standing in for "already removed by another path before
            // this sweep runs". A genuine same-run P2025 race (delete landing between
            // the sweep's read and its per-row delete) can't be triggered from outside
            // without instrumenting the route's internals, so this covers the outcome
            // that matters instead: a row that's already gone gets no removal email.
            const day7Gone = await prisma.person.create({
                data: { email: 'day7gone-pending-cron-email-test@example.com', name: 'Day7 Gone', household: { create: { name: 'Email Test HH D' } } }
            });
            eids.day7Gone = day7Gone.id;

            const now = Date.now();
            await prisma.programParticipant.createMany({
                data: [
                    { programId: emailProgramId, personId: eids.day6Child, status: 'PENDING', pendingSince: daysAgo(now, 6) },
                    { programId: emailProgramId, personId: eids.noEmailChild, status: 'PENDING', pendingSince: daysAgo(now, 3) },
                    { programId: emailProgramId, personId: eids.day7Valid, status: 'PENDING', pendingSince: daysAgo(now, 7) },
                    { programId: emailProgramId, personId: eids.day7Gone, status: 'PENDING', pendingSince: daysAgo(now, 7) },
                ]
            });

            await prisma.programParticipant.delete({
                where: { programId_personId: { programId: emailProgramId, personId: eids.day7Gone } }
            });
        });

        afterAll(async () => {
            const idList = Object.values(eids);
            await prisma.programParticipant.deleteMany({ where: { programId: emailProgramId } });
            await prisma.person.deleteMany({ where: { id: { in: idList } } });
            await prisma.program.deleteMany({ where: { id: emailProgramId } });
            await prisma.household.deleteMany({ where: { id: { in: [householdAId, householdBId] } } });
        });

        it('sends real warning/removal emails, once per rule, only for live rows', async () => {
            process.env.CRON_SECRET = 'test-secret';
            const res = await GET(mkReq('Bearer test-secret'));
            expect(res.status).toBe(200);

            const sent = __getSentEmails();

            // day-6 FINAL WARNING -> household lead AND the participant, both have email.
            const finalWarning = sent.filter((e) => e.subject === 'FINAL WARNING: 24 hours left to pay for Pending Cron Email Test Program');
            expect(finalWarning.map((e) => e.to).sort()).toEqual([
                'day6child-pending-cron-email-test@example.com',
                'leadA-pending-cron-email-test@example.com',
            ]);
            expect(finalWarning[0].html).toContain('Pending Cron Email Test Program');

            // day-3 reminder for the null-email child -> only the lead is resolved; no throw.
            const day3Warning = sent.filter((e) => e.subject === 'Please pay for Pending Cron Email Test Program within 4 days');
            expect(day3Warning.map((e) => e.to)).toEqual(['leadB-pending-cron-email-test@example.com']);

            // day-7 removal -> exactly one email, and only for the row that was actually
            // removed; the already-gone row (never entered the sweep) gets none.
            const removalEmails = sent.filter((e) => e.subject === 'Removed from Pending Cron Email Test Program due to non-payment');
            expect(removalEmails).toHaveLength(1);
            expect(removalEmails[0].to).toBe('day7valid-pending-cron-email-test@example.com');

            const day7ValidRow = await prisma.programParticipant.findUnique({
                where: { programId_personId: { programId: emailProgramId, personId: eids.day7Valid } }
            });
            expect(day7ValidRow).toBeNull();
        });
    });
});
