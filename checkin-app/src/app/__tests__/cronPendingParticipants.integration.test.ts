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

const DAY_MS = 24 * 60 * 60 * 1000;
// Half-day offset puts each row safely inside its target day so floor() is stable.
const daysAgo = (now: number, d: number) => new Date(now - d * DAY_MS - DAY_MS / 2);

describe('Cron Pending-Participants API Integration Tests', () => {
    let programId: number;
    const ids: Record<string, number> = {};

    const mkParticipant = async (key: string) => {
        const p = await prisma.participant.create({
            data: { email: `${key}-pending-cron-test@example.com`, name: `${key} Pending Cron`, household: { create: {} } }
        });
        ids[key] = p.id;
        return p.id;
    };

    beforeAll(async () => {
        // Clean up any leaked state
        const leaked = await prisma.participant.findMany({
            where: { email: { contains: 'pending-cron-test' } },
            select: { id: true }
        });
        const leakedIds = leaked.map(u => u.id);
        await prisma.programParticipant.deleteMany({ where: { participantId: { in: leakedIds } } });
        await prisma.participant.deleteMany({ where: { id: { in: leakedIds } } });
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
        await mkParticipant('plan'); // isPaymentPlanRequested -> never swept

        await prisma.programParticipant.createMany({
            data: [
                { programId, participantId: ids.day1, status: 'PENDING', pendingSince: daysAgo(now, 1) },
                { programId, participantId: ids.day3, status: 'PENDING', pendingSince: daysAgo(now, 3) },
                { programId, participantId: ids.day6, status: 'PENDING', pendingSince: daysAgo(now, 6) },
                { programId, participantId: ids.day7, status: 'PENDING', pendingSince: daysAgo(now, 7) },
                { programId, participantId: ids.plan, status: 'PENDING', pendingSince: daysAgo(now, 8), isPaymentPlanRequested: true },
            ]
        });
    });

    afterAll(async () => {
        const idList = Object.values(ids);
        await prisma.programParticipant.deleteMany({ where: { programId } });
        await prisma.participant.deleteMany({ where: { id: { in: idList } } });
        await prisma.program.deleteMany({ where: { id: programId } });
    });

    const mkReq = (auth?: string) => new Request('http://localhost:4000/api/cron/pending-participants', {
        method: 'GET',
        headers: auth ? { authorization: auth } : {}
    }) as unknown as Request;

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

            // DB reality: only day7 deleted; the warned rows and the payment-plan row survive.
            const survivors = await prisma.programParticipant.findMany({ where: { programId } });
            const survivorPids = survivors.map(s => s.participantId).sort((a, b) => a - b);
            expect(survivorPids).toEqual([ids.day1, ids.day3, ids.day6, ids.plan].sort((a, b) => a - b));

            const day7 = await prisma.programParticipant.findUnique({
                where: { programId_participantId: { programId, participantId: ids.day7 } }
            });
            expect(day7).toBeNull();
        });
    });
});
