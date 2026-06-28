/**
 * @jest-environment node
 */
/**
 * Concurrency regression test for the public registration capacity lock.
 *
 * Capacity used to be checked against a `_count` read BEFORE the create
 * transaction. Two near-simultaneous registrations for the last seat both read
 * count==max-1, both passed, and both inserted — overfilling the program. This
 * flow is public/unauthenticated, so it is trivially raced.
 *
 * The fix locks the Program row (SELECT ... FOR UPDATE) and re-counts INSIDE the
 * create transaction. That transaction now lives in the double-opt-in *confirm*
 * step, so this test fires two concurrent confirmations (with pre-built tokens,
 * which is exactly what the confirmation links carry) for a 1-seat program and
 * asserts exactly one succeeds and the program is not overfilled.
 *
 * (jest.setup.js gives this suite TEST_DB_POOL_MAX=2 so the two transactions
 * run on separate connections; the FOR UPDATE lock is then the only thing
 * serializing them, exactly as in production. With pool 1 the assertions pass
 * even without the lock.)
 */
import { POST as CONFIRM } from '@/app/api/programs/[id]/public-register/confirm/route';
import { encodeRegistrationToken } from '@/lib/registrationToken';
import prisma from '@/lib/prisma';

process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-conc';

jest.mock('@/lib/notifications', () => ({
    sendNotification: jest.fn().mockResolvedValue(true),
}));

const NAME_TAG = 'PublicRegConcurrency Test';

describe('public-register/confirm concurrency (capacity lock)', () => {
    let programId: number;

    async function cleanup() {
        const progs = await prisma.program.findMany({
            where: { name: { contains: NAME_TAG } },
            select: { id: true },
        });
        const progIds = progs.map(p => p.id);
        // Households created by registrations: reached via their enrolled members.
        const members = await prisma.person.findMany({
            where: { programParticipants: { some: { programId: { in: progIds } } } },
            select: { id: true, householdId: true },
        });
        const householdIds = [...new Set(members.map(m => m.householdId))];
        await prisma.programParticipant.deleteMany({ where: { programId: { in: progIds } } });
        await prisma.emergencyContact.deleteMany({ where: { householdId: { in: householdIds } } });
        await prisma.householdLead.deleteMany({ where: { householdId: { in: householdIds } } });
        await prisma.auditLog.deleteMany({ where: { actorId: { in: members.map(m => m.id) } } });
        await prisma.person.deleteMany({ where: { householdId: { in: householdIds } } });
        await prisma.household.deleteMany({ where: { id: { in: householdIds } } });
        await prisma.program.deleteMany({ where: { id: { in: progIds } } });
    }

    beforeAll(async () => {
        await cleanup();
        const program = await prisma.program.create({
            data: {
                name: NAME_TAG,
                phase: 'RUNNING',
                enrollmentStatus: 'OPEN',
                maxParticipants: 1, // exactly one seat
                orgMemberPriceCents: null,
                nonOrgMemberPriceCents: null, // free → no payment/checkout path
            },
        });
        programId = program.id;
    });

    afterAll(cleanup);

    const params = (id: number) => ({ params: Promise.resolve({ id: id.toString() }) });

    // A confirmation request carrying the same payload the email link would.
    function confirmation(idx: number) {
        const token = encodeRegistrationToken({
            programId,
            parents: [{ name: `Parent ${idx}`, email: `pubreg-conc-${idx}@example.com`, phone: `555-000-000${idx}` }],
            emergencyContact: { name: `Aunt ${idx}`, phone: `555-111-222${idx}` },
            participants: [{ name: `Kid ${idx}`, dob: '2015-01-01' }],
        });
        return new Request(`http://localhost:4000/api/programs/${programId}/public-register/confirm`, {
            method: 'POST',
            body: JSON.stringify({ token }),
        });
    }

    it('two concurrent confirmations for the last seat → exactly one succeeds, no overfill', async () => {
        const [resA, resB] = await Promise.all([
            CONFIRM(confirmation(1) as unknown as import('next/server').NextRequest, params(programId) as unknown as never),
            CONFIRM(confirmation(2) as unknown as import('next/server').NextRequest, params(programId) as unknown as never),
        ]);

        const statuses = [resA.status, resB.status].sort();
        // Exactly one 200, one 400 (capacity rejected) — never two 200s.
        expect(statuses).toEqual([200, 400]);

        const loser = resA.status === 400 ? resA : resB;
        expect((await loser.json()).error).toMatch(/Not enough open spots/i);

        // The core invariant: the program holds at most its capacity.
        const enrolled = await prisma.programParticipant.count({ where: { programId } });
        expect(enrolled).toBe(1);
    });
});
