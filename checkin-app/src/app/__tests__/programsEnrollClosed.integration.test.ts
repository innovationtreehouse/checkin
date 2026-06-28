/**
 * @jest-environment node
 */
/**
 * Guard: a CLOSED program rejects new enrollments on BOTH enroll paths —
 * authenticated self-enroll (POST /api/programs/[id]/participants) and the
 * public/unauthenticated registration (POST /api/programs/[id]/public-register).
 * Both check enrollmentStatus === 'CLOSED' and return 400; neither was tested.
 */
import { POST as ENROLL } from '@/app/api/programs/[id]/participants/route';
import { POST as PUBLIC_REGISTER } from '@/app/api/programs/[id]/public-register/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/notifications', () => ({ sendNotification: jest.fn().mockResolvedValue(true) }));

const TAG = 'enroll-closed-test';

describe('Enroll into a CLOSED program is rejected (both paths)', () => {
    let userId: number;
    let closedProgramId: number;

    async function cleanup() {
        const progs = await prisma.program.findMany({ where: { name: { contains: TAG } }, select: { id: true } });
        const progIds = progs.map(p => p.id);
        await prisma.programParticipant.deleteMany({ where: { programId: { in: progIds } } });
        // Households spawned by public-register (reached via enrolled members) + the test user.
        const members = await prisma.participant.findMany({ where: { OR: [{ email: { contains: TAG } }, { programParticipants: { some: { programId: { in: progIds } } } }] }, select: { id: true, householdId: true } });
        const hhIds = [...new Set(members.map(m => m.householdId).filter((x): x is number => x != null))];
        await prisma.auditLog.deleteMany({ where: { actorId: { in: members.map(m => m.id) } } });
        await prisma.emergencyContact.deleteMany({ where: { householdId: { in: hhIds } } });
        await prisma.householdLead.deleteMany({ where: { householdId: { in: hhIds } } });
        await prisma.participant.deleteMany({ where: { householdId: { in: hhIds } } });
        await prisma.household.deleteMany({ where: { id: { in: hhIds } } });
        await prisma.program.deleteMany({ where: { id: { in: progIds } } });
    }

    beforeAll(async () => {
        await cleanup();
        const user = await prisma.participant.create({ data: { email: `user-${TAG}@example.com`, name: 'Self Enroller', household: { create: {} } } });
        userId = user.id;
        const program = await prisma.program.create({
            data: { name: `Closed ${TAG}`, phase: 'RUNNING', enrollmentStatus: 'CLOSED', memberPriceCents: null, nonMemberPriceCents: null },
        });
        closedProgramId = program.id;
    });

    afterAll(async () => {
        await cleanup();
        await prisma.$disconnect();
    });

    const params = (id: number) => ({ params: Promise.resolve({ id: id.toString() }) });

    it('authenticated self-enroll into a CLOSED program → 400 closed', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({ user: { id: userId } });
        const req = new Request(`http://localhost:4000/api/programs/${closedProgramId}/participants`, {
            method: 'POST',
            body: JSON.stringify({ participantId: userId }),
        });
        const res = await ENROLL(req as unknown as import('next/server').NextRequest, params(closedProgramId) as unknown as never);
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/closed/i);
        // No enrollment row written.
        expect(await prisma.programParticipant.count({ where: { programId: closedProgramId } })).toBe(0);
    });

    it('public-register into a CLOSED program → 400 closed', async () => {
        const req = new Request(`http://localhost:4000/api/programs/${closedProgramId}/public-register`, {
            method: 'POST',
            body: JSON.stringify({
                parents: [{ name: `Parent ${TAG}`, email: `parent-${TAG}@example.com`, phone: '555-000-0001' }],
                emergencyContact: { name: 'Aunt', phone: '555-111-2222' },
                participants: [{ name: 'Kid', dob: '2015-01-01' }],
            }),
        });
        const res = await PUBLIC_REGISTER(req as unknown as import('next/server').NextRequest, params(closedProgramId) as unknown as never);
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/closed/i);
        // Closed-check happens before any household/enrollment writes.
        expect(await prisma.programParticipant.count({ where: { programId: closedProgramId } })).toBe(0);
    });
});
