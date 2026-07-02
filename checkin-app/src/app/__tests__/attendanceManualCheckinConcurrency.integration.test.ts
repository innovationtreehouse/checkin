/**
 * @jest-environment node
 */
/**
 * Concurrency regression test for POST /api/attendance (type: MANUAL_CHECKIN).
 *
 * The dashboard/household MANUAL_CHECKIN path used to read "already checked in?"
 * then create a visit with no $transaction and no advisory lock (route.ts ~173).
 * Two concurrent MANUAL_CHECKINs for one participant — or one racing /api/scan or
 * /api/attendance/manual — both passed the guard and both created an open visit,
 * leaving two open rows. A later checkout closes only one; the other lingers open
 * forever, inflating the open-visit count and corrupting two-deep math.
 *
 * The fix wraps the re-check + create in a $transaction that takes
 * `pg_advisory_xact_lock(participantId)` first. One request wins (200, creates the
 * visit); the loser re-checks under the lock, sees the open visit, and returns the
 * existing "already checked in" 400. Either way exactly one open visit survives.
 *
 * (jest.setup.js gives this suite a pool of 2 via TEST_DB_POOL_MAX so the two
 * transactions run on separate connections — the advisory lock is then the *only*
 * thing serializing them, as in production. Deleting the pg_advisory_xact_lock line
 * in route.ts, or the partial unique index, makes this suite fail.)
 */
import { POST } from '@/app/api/attendance/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn(),
}));

const EMAIL_TAG = 'manual-checkin-concurrency-test';

function checkinRequest(participantId: number) {
    return new Request('http://localhost:4000/api/attendance', {
        method: 'POST',
        body: JSON.stringify({ type: 'MANUAL_CHECKIN', participantId }),
    }) as unknown as import('next/server').NextRequest;
}

async function openVisitCount(participantId: number) {
    return prisma.visit.count({ where: { personId: participantId, departedAt: null } });
}

describe('POST /api/attendance MANUAL_CHECKIN concurrency (advisory lock)', () => {
    let subjectId: number;
    let householdId: number;

    beforeAll(async () => {
        // Clean any leaked state from a prior run.
        const leaked = await prisma.participant.findMany({
            where: { email: { contains: EMAIL_TAG } },
            select: { id: true, householdId: true },
        });
        const leakedIds = leaked.map(p => p.id);
        const leakedHouseholdIds = leaked.map(p => p.householdId);
        await prisma.visit.deleteMany({ where: { personId: { in: leakedIds } } });
        await prisma.auditLog.deleteMany({ where: { actorId: { in: leakedIds } } });
        await prisma.participant.deleteMany({ where: { id: { in: leakedIds } } });
        await prisma.household.deleteMany({ where: { id: { in: leakedHouseholdIds } } });

        const subject = await prisma.participant.create({
            data: { email: `subject-${EMAIL_TAG}@example.com`, name: 'Manual Checkin Concurrency Subject', household: { create: {} } },
        });
        subjectId = subject.id;
        householdId = subject.householdId;
    });

    afterAll(async () => {
        await prisma.visit.deleteMany({ where: { personId: subjectId } });
        await prisma.auditLog.deleteMany({ where: { actorId: subjectId } });
        await prisma.participant.deleteMany({ where: { id: subjectId } });
        await prisma.household.deleteMany({ where: { id: householdId } });
    });

    it('two concurrent MANUAL_CHECKINs → exactly one open visit, no 500', async () => {
        // Fresh state: no open visit before the race.
        await prisma.visit.deleteMany({ where: { personId: subjectId } });
        expect(await openVisitCount(subjectId)).toBe(0);

        // Subject checks themselves in (isSelf → passes the permission guard).
        (getServerSession as jest.Mock).mockResolvedValue({ user: { id: subjectId } });

        const [resA, resB] = await Promise.all([
            POST(checkinRequest(subjectId)) as Promise<Response>,
            POST(checkinRequest(subjectId)) as Promise<Response>,
        ]);

        const statuses = [resA.status, resB.status].sort();
        // One winner creates the visit (200); the loser re-checks under the lock,
        // sees the open visit, and cleanly returns "already checked in" (400).
        // Neither path 500s.
        expect(statuses).toEqual([200, 400]);

        // The core invariant: the race did not open two visits.
        expect(await openVisitCount(subjectId)).toBe(1);
    });
});
