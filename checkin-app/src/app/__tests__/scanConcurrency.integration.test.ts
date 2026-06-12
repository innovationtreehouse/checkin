/**
 * @jest-environment node
 */
/**
 * Concurrency regression tests for POST /api/scan.
 *
 * Steps 4–6 of the scan route (debounce read → record badge event → find open
 * visit → check-in/out) are a read-modify-write on a participant's visit state.
 * Before the per-participant advisory lock, two near-simultaneous scans for the
 * same participant could both pass the debounce read and both observe the same
 * visit state before either wrote, producing:
 *   - two open visits for one participant (double check-in), or
 *   - a double check-out that 500s on Prisma P2025 when the second deletes the
 *     visit the first already removed.
 *
 * The fix wraps steps 4–6 in a single $transaction that takes
 * `pg_advisory_xact_lock(participantId)` first, so same-participant scans
 * serialize. These tests fire two concurrent POSTs with Promise.all and assert
 * the committed state and the response pair.
 *
 * (Note: the test pool is capped at one connection, which on its own serializes
 * the two transactions; the advisory lock is what protects production, where the
 * pool holds many connections. Both mechanisms yield the same observable result
 * asserted here.)
 */
import { POST } from '@/app/api/scan/route';
import prisma from '@/lib/prisma';
import { authenticateRequest } from '@/lib/auth';

jest.mock('@/lib/auth', () => ({
    authenticateRequest: jest.fn(),
}));

// Keep notifications/post-event side effects out of the DB-facing assertions.
jest.mock('@/lib/notifications', () => ({
    sendCheckinNotifications: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/logger', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    logBackendError: jest.fn(),
}));

const EMAIL_TAG = 'scan-concurrency-test';

function scanRequest(participantId: number) {
    return new Request('http://localhost:4000/api/scan', {
        method: 'POST',
        body: JSON.stringify({ participantId }),
    }) as unknown as import('next/server').NextRequest;
}

async function openVisitCount(participantId: number) {
    return prisma.visit.count({ where: { participantId, departed: null } });
}

describe('POST /api/scan concurrency (advisory lock)', () => {
    let keeperId: number;       // keyholder kept checked in so the facility stays open
    let checkinSubjectId: number;
    let checkoutSubjectId: number;

    beforeAll(async () => {
        // Kiosk auth for every scan in this suite.
        (authenticateRequest as jest.Mock).mockResolvedValue({ type: 'kiosk' });

        // Clean any leaked state from a prior run.
        const leaked = await prisma.participant.findMany({
            where: { email: { contains: EMAIL_TAG } },
            select: { id: true, householdId: true },
        });
        const leakedIds = leaked.map(p => p.id);
        const leakedHouseholdIds = leaked.map(p => p.householdId);
        await prisma.visit.deleteMany({ where: { participantId: { in: leakedIds } } });
        await prisma.rawBadgeEvent.deleteMany({ where: { participantId: { in: leakedIds } } });
        await prisma.participant.deleteMany({ where: { id: { in: leakedIds } } });
        await prisma.household.deleteMany({ where: { id: { in: leakedHouseholdIds } } });

        const keeper = await prisma.participant.create({
            data: { email: `keeper-${EMAIL_TAG}@example.com`, name: 'Keeper', keyholder: true, household: { create: {} } },
        });
        keeperId = keeper.id;
        // Keep the keyholder checked in so non-keyholder check-ins are allowed
        // and non-keyholder check-outs skip the last-keyholder force-close path.
        await prisma.visit.create({ data: { participantId: keeperId, arrived: new Date() } });

        const checkinSubject = await prisma.participant.create({
            data: { email: `checkin-${EMAIL_TAG}@example.com`, name: 'Checkin Subject', household: { create: {} } },
        });
        checkinSubjectId = checkinSubject.id;

        const checkoutSubject = await prisma.participant.create({
            data: { email: `checkout-${EMAIL_TAG}@example.com`, name: 'Checkout Subject', household: { create: {} } },
        });
        checkoutSubjectId = checkoutSubject.id;
    });

    afterAll(async () => {
        const ids = [keeperId, checkinSubjectId, checkoutSubjectId].filter(id => id !== undefined);
        const households = (await prisma.participant.findMany({
            where: { id: { in: ids } },
            select: { householdId: true },
        })).map(p => p.householdId);
        await prisma.visit.deleteMany({ where: { participantId: { in: ids } } });
        await prisma.rawBadgeEvent.deleteMany({ where: { participantId: { in: ids } } });
        await prisma.participant.deleteMany({ where: { id: { in: ids } } });
        await prisma.household.deleteMany({ where: { id: { in: households } } });
    });

    it('two concurrent check-in scans → exactly one open visit, one checkin + one debounce', async () => {
        // Fresh state: no open visit, no recent badge event (so neither scan is
        // pre-debounced before the race even begins).
        await prisma.visit.deleteMany({ where: { participantId: checkinSubjectId } });
        await prisma.rawBadgeEvent.deleteMany({ where: { participantId: checkinSubjectId } });
        expect(await openVisitCount(checkinSubjectId)).toBe(0);

        const [resA, resB] = await Promise.all([
            POST(scanRequest(checkinSubjectId)) as Promise<Response>,
            POST(scanRequest(checkinSubjectId)) as Promise<Response>,
        ]);

        // Neither request errors.
        expect(resA.status).toBe(200);
        expect(resB.status).toBe(200);

        const bodies = await Promise.all([resA.json(), resB.json()]);
        const types = bodies.map(b => b.type).sort();
        expect(types).toEqual(['checkin', 'ignored_debounce']);

        // The core invariant: the race did not open two visits.
        expect(await openVisitCount(checkinSubjectId)).toBe(1);
    });

    it('two concurrent check-out scans → exactly one successful checkout, no 500, zero open visits', async () => {
        // Fresh state: exactly one open visit, no recent badge event.
        await prisma.visit.deleteMany({ where: { participantId: checkoutSubjectId } });
        await prisma.rawBadgeEvent.deleteMany({ where: { participantId: checkoutSubjectId } });
        await prisma.visit.create({ data: { participantId: checkoutSubjectId, arrived: new Date() } });
        expect(await openVisitCount(checkoutSubjectId)).toBe(1);

        const [resA, resB] = await Promise.all([
            POST(scanRequest(checkoutSubjectId)) as Promise<Response>,
            POST(scanRequest(checkoutSubjectId)) as Promise<Response>,
        ]);

        // No spurious 500 from a double-delete (Prisma P2025).
        expect(resA.status).toBe(200);
        expect(resB.status).toBe(200);

        const bodies = await Promise.all([resA.json(), resB.json()]);
        const types = bodies.map(b => b.type).sort();
        expect(types).toEqual(['checkout', 'ignored_debounce']);

        // The visit was closed exactly once.
        expect(await openVisitCount(checkoutSubjectId)).toBe(0);
    });
});
