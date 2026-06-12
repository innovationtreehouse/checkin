/**
 * @jest-environment node
 */
/**
 * Integration tests for the previously-untested payment-plan routes:
 *   GET  /api/programs/payment-plans               (board-only queue)
 *   POST /api/programs/payment-plans               (board approves → ACTIVE)
 *   POST /api/programs/[id]/request-payment-plan   (request, with IDOR guard)
 *
 * Covers auth rejections (401/403), validation (400/404), the IDOR path
 * (an unrelated authenticated user requesting on someone else's enrollment),
 * and the successful state transitions.
 */
import { GET as PlansGet, POST as PlansPost } from '@/app/api/programs/payment-plans/route';
import { POST as RequestPost } from '@/app/api/programs/[id]/request-payment-plan/route';
import prisma from '@/lib/prisma';

jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mockSession = require('next-auth/next').getServerSession;

const TAG = 'payment-plans-test';

describe('Program payment-plan routes', () => {
    let programId: number;
    let mentorId: number;
    let boardId: number;
    let selfId: number;
    let otherId: number;
    let noiseId: number;
    const householdIds: number[] = [];

    beforeAll(async () => {
        const mentor = await prisma.participant.create({
            data: { name: 'PP Mentor', email: `mentor-${TAG}@example.com`, household: { create: {} } },
        });
        mentorId = mentor.id;
        householdIds.push(mentor.householdId);

        const program = await prisma.program.create({
            data: { name: `PP Program ${TAG}`, leadMentorId: mentorId, enrollmentStatus: 'OPEN' },
        });
        programId = program.id;

        const board = await prisma.participant.create({
            data: { name: 'PP Board', email: `board-${TAG}@example.com`, boardMember: true, household: { create: {} } },
        });
        boardId = board.id;
        householdIds.push(board.householdId);

        const self = await prisma.participant.create({
            data: { name: 'PP Self', email: `self-${TAG}@example.com`, household: { create: {} } },
        });
        selfId = self.id;
        householdIds.push(self.householdId);

        const other = await prisma.participant.create({
            data: { name: 'PP Other', email: `other-${TAG}@example.com`, household: { create: {} } },
        });
        otherId = other.id;
        householdIds.push(other.householdId);

        const noise = await prisma.participant.create({
            data: { name: 'PP Noise', email: `noise-${TAG}@example.com`, household: { create: {} } },
        });
        noiseId = noise.id;
        householdIds.push(noise.householdId);
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterAll(async () => {
        await prisma.programParticipant.deleteMany({ where: { programId } });
        await prisma.program.delete({ where: { id: programId } });
        await prisma.participant.deleteMany({
            where: { id: { in: [mentorId, boardId, selfId, otherId, noiseId] } },
        });
        await prisma.household.deleteMany({ where: { id: { in: householdIds } } });
    });

    async function enroll(participantId: number, opts: { requested: boolean }) {
        await prisma.programParticipant.upsert({
            where: { programId_participantId: { programId, participantId } },
            update: { status: 'PENDING', paymentPlanRequested: opts.requested, pendingSince: new Date() },
            create: { programId, participantId, status: 'PENDING', paymentPlanRequested: opts.requested, pendingSince: new Date() },
        });
    }

    function requestReq(body: unknown) {
        return new Request(`http://localhost/api/programs/${programId}/request-payment-plan`, {
            method: 'POST',
            body: JSON.stringify(body),
        });
    }

    describe('GET /api/programs/payment-plans', () => {
        it('401 without a session', async () => {
            mockSession.mockResolvedValue(null);
            const res = await PlansGet();
            expect(res.status).toBe(401);
        });

        it('403 for a non-board, non-sysadmin user', async () => {
            mockSession.mockResolvedValue({ user: { id: selfId } });
            const res = await PlansGet();
            expect(res.status).toBe(403);
        });

        it('returns only PENDING + paymentPlanRequested rows to a board member', async () => {
            await enroll(selfId, { requested: true });   // should appear
            await enroll(noiseId, { requested: false });  // should NOT appear
            mockSession.mockResolvedValue({ user: { id: boardId, boardMember: true } });

            const res = await PlansGet();
            expect(res.status).toBe(200);
            const rows = await res.json();
            const ids = rows.map((r: { participantId: number }) => r.participantId);
            expect(ids).toContain(selfId);
            expect(ids).not.toContain(noiseId);
        });
    });

    describe('POST /api/programs/payment-plans (approve)', () => {
        it('401 without a session', async () => {
            mockSession.mockResolvedValue(null);
            const res = await PlansPost(new Request('http://localhost', { method: 'POST', body: '{}' }));
            expect(res.status).toBe(401);
        });

        it('403 for a non-board user', async () => {
            mockSession.mockResolvedValue({ user: { id: selfId } });
            const res = await PlansPost(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ programId, participantId: selfId }) }));
            expect(res.status).toBe(403);
        });

        it('board approval flips the enrollment to ACTIVE and clears the request flags', async () => {
            await enroll(selfId, { requested: true });
            mockSession.mockResolvedValue({ user: { id: boardId, boardMember: true } });

            const res = await PlansPost(new Request('http://localhost', {
                method: 'POST',
                body: JSON.stringify({ programId, participantId: selfId }),
            }));
            expect(res.status).toBe(200);

            const row = await prisma.programParticipant.findUnique({
                where: { programId_participantId: { programId, participantId: selfId } },
            });
            expect(row?.status).toBe('ACTIVE');
            expect(row?.paymentPlanRequested).toBe(false);
            expect(row?.pendingSince).toBeNull();
        });
    });

    describe('POST /api/programs/[id]/request-payment-plan', () => {
        const params = (id: string | number) => ({ params: Promise.resolve({ id: String(id) }) });

        it('401 without a session', async () => {
            mockSession.mockResolvedValue(null);
            const res = await RequestPost(requestReq({ participantId: selfId }), params(programId));
            expect(res.status).toBe(401);
        });

        it('400 on a non-numeric program id', async () => {
            mockSession.mockResolvedValue({ user: { id: selfId } });
            const res = await RequestPost(requestReq({ participantId: selfId }), params('abc'));
            expect(res.status).toBe(400);
        });

        it('400 when participantId is missing', async () => {
            mockSession.mockResolvedValue({ user: { id: selfId } });
            const res = await RequestPost(requestReq({}), params(programId));
            expect(res.status).toBe(400);
        });

        it('404 when the participant is not enrolled in the program', async () => {
            await prisma.programParticipant.deleteMany({ where: { programId, participantId: otherId } });
            mockSession.mockResolvedValue({ user: { id: boardId, boardMember: true } });
            const res = await RequestPost(requestReq({ participantId: otherId }), params(programId));
            expect(res.status).toBe(404);
        });

        it('403 (IDOR) when an unrelated user requests on someone else\'s enrollment', async () => {
            await enroll(selfId, { requested: false });
            // `otherId` is just an authenticated user — not self, lead, board, or household lead.
            mockSession.mockResolvedValue({ user: { id: otherId } });
            const res = await RequestPost(requestReq({ participantId: selfId }), params(programId));
            expect(res.status).toBe(403);

            const row = await prisma.programParticipant.findUnique({
                where: { programId_participantId: { programId, participantId: selfId } },
            });
            expect(row?.paymentPlanRequested).toBe(false);
        });

        it('200 when the participant requests their own payment plan', async () => {
            await enroll(selfId, { requested: false });
            mockSession.mockResolvedValue({ user: { id: selfId } });
            const res = await RequestPost(requestReq({ participantId: selfId }), params(programId));
            expect(res.status).toBe(200);

            const row = await prisma.programParticipant.findUnique({
                where: { programId_participantId: { programId, participantId: selfId } },
            });
            expect(row?.paymentPlanRequested).toBe(true);
        });
    });
});
