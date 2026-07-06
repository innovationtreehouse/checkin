/**
 * @jest-environment node
 */
/**
 * Integration tests for the previously-untested payment-plan routes:
 *   GET  /api/finance-ops/payment-plans               (board-only queue)
 *   POST /api/finance-ops/payment-plans               (board approves → ACTIVE)
 *   POST /api/programs/[id]/request-payment-plan   (request, with IDOR guard)
 *
 * Covers auth rejections (401/403), validation (400/404), the IDOR path
 * (an unrelated authenticated user requesting on someone else's enrollment),
 * and the successful state transitions.
 */
import { GET as PlansGet, POST as PlansPost } from '@/app/api/finance-ops/payment-plans/route';
import { POST as RequestPost } from '@/app/api/programs/[id]/request-payment-plan/route';
import { POST as ParticipantsPost } from '@/app/api/programs/[id]/participants/route';
import prisma from '@/lib/prisma';

jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn(),
}));
jest.mock('@/lib/notifications', () => ({
    sendNotification: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mockSession = require('next-auth/next').getServerSession;

const TAG = 'payment-plans-test';

// GET is now a security handler() and POST a withAuth() wrapper — both take a
// NextRequest. Plain Request carries the fields authenticateRequest reads.
function nextReq(url = 'http://localhost/api/finance-ops/payment-plans', init?: RequestInit) {
    return new Request(url, init) as unknown as import('next/server').NextRequest;
}

describe('Program payment-plan routes', () => {
    let programId: number;
    let mentorId: number;
    let boardId: number;
    let boardKinId: number;
    let selfId: number;
    let otherId: number;
    let noiseId: number;
    let memberId: number;
    const householdIds: number[] = [];

    beforeAll(async () => {
        const mentor = await prisma.person.create({
            data: { name: 'PP Mentor', email: `mentor-${TAG}@example.com`, household: { create: { name: "Test HH" } } },
        });
        mentorId = mentor.id;
        householdIds.push(mentor.householdId);

        const program = await prisma.program.create({
            data: { name: `PP Program ${TAG}`, leadMentorId: mentorId, enrollmentStatus: 'OPEN' },
        });
        programId = program.id;

        const board = await prisma.person.create({
            data: { name: 'PP Board', email: `board-${TAG}@example.com`, isBoardMember: true, household: { create: { name: "Test HH" } } },
        });
        boardId = board.id;
        householdIds.push(board.householdId);

        // A household-mate of the board member — the conflict-of-interest target.
        const boardKin = await prisma.person.create({
            data: { name: 'PP Board Kin', email: `boardkin-${TAG}@example.com`, householdId: board.householdId },
        });
        boardKinId = boardKin.id;

        const self = await prisma.person.create({
            data: { name: 'PP Self', email: `self-${TAG}@example.com`, household: { create: { name: "Test HH" } } },
        });
        selfId = self.id;
        householdIds.push(self.householdId);

        const other = await prisma.person.create({
            data: { name: 'PP Other', email: `other-${TAG}@example.com`, household: { create: { name: "Test HH" } } },
        });
        otherId = other.id;
        householdIds.push(other.householdId);

        const noise = await prisma.person.create({
            data: { name: 'PP Noise', email: `noise-${TAG}@example.com`, household: { create: { name: "Test HH" } } },
        });
        noiseId = noise.id;
        householdIds.push(noise.householdId);

        // Household with an ACTIVE org membership, for the point-in-time snapshot tests.
        const member = await prisma.person.create({
            data: { name: 'PP Member', email: `member-${TAG}@example.com`, household: { create: { name: "Member HH", orgMembership: { create: { status: 'ACTIVE' } } } } },
        });
        memberId = member.id;
        householdIds.push(member.householdId);
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterAll(async () => {
        await prisma.programParticipant.deleteMany({ where: { programId } });
        await prisma.program.delete({ where: { id: programId } });
        await prisma.person.deleteMany({
            where: { id: { in: [mentorId, boardId, boardKinId, selfId, otherId, noiseId, memberId] } },
        });
        await prisma.orgMembership.deleteMany({ where: { householdId: { in: householdIds } } });
        await prisma.household.deleteMany({ where: { id: { in: householdIds } } });
    });

    async function enroll(participantId: number, opts: { requested: boolean }) {
        await prisma.programParticipant.upsert({
            where: { programId_personId: { programId, personId: participantId } },
            update: { status: 'PENDING', isPaymentPlanRequested: opts.requested, pendingSince: new Date() },
            create: { programId, personId: participantId, status: 'PENDING', isPaymentPlanRequested: opts.requested, pendingSince: new Date() },
        });
    }

    function requestReq(body: unknown) {
        return new Request(`http://localhost/api/programs/${programId}/request-payment-plan`, {
            method: 'POST',
            body: JSON.stringify(body),
        }) as unknown as import("next/server").NextRequest;
    }

    describe('GET /api/finance-ops/payment-plans', () => {
        it('401 without a session', async () => {
            mockSession.mockResolvedValue(null);
            const res = await PlansGet(nextReq());
            expect(res.status).toBe(401);
        });

        it('403 for a non-board, non-sysadmin user', async () => {
            mockSession.mockResolvedValue({ user: { id: selfId } });
            const res = await PlansGet(nextReq());
            expect(res.status).toBe(403);
        });

        it('returns only PENDING + isPaymentPlanRequested rows to a board member', async () => {
            await enroll(selfId, { requested: true });   // should appear
            await enroll(noiseId, { requested: false });  // should NOT appear
            mockSession.mockResolvedValue({ user: { id: boardId, isBoardMember: true } });

            const res = await PlansGet(nextReq());
            expect(res.status).toBe(200);
            const { ProgramParticipant: rows } = await res.json();
            const ids = rows.map((r: { personId: number }) => r.personId);
            expect(ids).toContain(selfId);
            expect(ids).not.toContain(noiseId);
        });

        it('includes each participant\'s CURRENT household org-membership status (live, for the board to decide)', async () => {
            await enroll(memberId, { requested: true });
            await enroll(selfId, { requested: true }); // selfId's household has no OrgMembership row
            mockSession.mockResolvedValue({ user: { id: boardId, isBoardMember: true } });

            const res = await PlansGet(nextReq());
            expect(res.status).toBe(200);
            const { ProgramParticipant: rows } = await res.json();
            type Row = { personId: number; person: { household?: { orgMembership?: { status: string } | null } | null } };
            const memberRow = (rows as Row[]).find(r => r.personId === memberId);
            const nonMemberRow = (rows as Row[]).find(r => r.personId === selfId);
            expect(memberRow?.person.household?.orgMembership?.status).toBe('ACTIVE');
            expect(nonMemberRow?.person.household?.orgMembership).toBeFalsy();
        });

        it('ships the next-year flag inputs: program.startAt + a BoardSettings key', async () => {
            // The flag itself is derived on the client (the stripper drops ad-hoc
            // booleans); the route's job is only to ship both inputs — the program's
            // start date and the membership-year cutoff singleton. Don't mutate the
            // BoardSettings singleton here (it's global across the integration DB);
            // just assert the key rides along and startAt round-trips.
            const startAt = new Date('2999-10-01T00:00:00Z');
            await prisma.program.update({ where: { id: programId }, data: { startAt } });
            await enroll(selfId, { requested: true });
            mockSession.mockResolvedValue({ user: { id: boardId, isBoardMember: true } });

            const res = await PlansGet(nextReq());
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body).toHaveProperty('BoardSettings');
            const row = body.ProgramParticipant.find((r: { personId: number }) => r.personId === selfId);
            expect(row.program.startAt).toBe(startAt.toISOString());
        });
    });

    describe('POST /api/finance-ops/payment-plans (approve)', () => {
        it('401 without a session', async () => {
            mockSession.mockResolvedValue(null);
            const res = await PlansPost(nextReq('http://localhost', { method: 'POST', body: '{}' }));
            expect(res.status).toBe(401);
        });

        it('403 for a non-board user', async () => {
            mockSession.mockResolvedValue({ user: { id: selfId } });
            const res = await PlansPost(nextReq('http://localhost', { method: 'POST', body: JSON.stringify({ programId, participantId: selfId }) }));
            expect(res.status).toBe(403);
        });

        it('board approval flips the enrollment to ACTIVE and clears the request flags', async () => {
            await enroll(selfId, { requested: true });
            mockSession.mockResolvedValue({ user: { id: boardId, isBoardMember: true } });

            const res = await PlansPost(nextReq('http://localhost', {
                method: 'POST',
                body: JSON.stringify({ programId, participantId: selfId }),
            }));
            expect(res.status).toBe(200);

            const row = await prisma.programParticipant.findUnique({
                where: { programId_personId: { programId, personId: selfId } },
            });
            expect(row?.status).toBe('ACTIVE');
            expect(row?.isPaymentPlanRequested).toBe(false);
            expect(row?.pendingSince).toBeNull();
        });

        it('stamps wasOrgMemberAtApproval=true approving a participant from an ACTIVE-membership household', async () => {
            await enroll(memberId, { requested: true });
            mockSession.mockResolvedValue({ user: { id: boardId, isBoardMember: true } });

            const res = await PlansPost(nextReq('http://localhost', {
                method: 'POST',
                body: JSON.stringify({ programId, participantId: memberId }),
            }));
            expect(res.status).toBe(200);

            const row = await prisma.programParticipant.findUnique({
                where: { programId_personId: { programId, personId: memberId } },
            });
            expect(row?.wasOrgMemberAtApproval).toBe(true);
        });

        it('stamps wasOrgMemberAtApproval=false approving a participant from a non-member household', async () => {
            await enroll(selfId, { requested: true }); // selfId's household has no OrgMembership row
            mockSession.mockResolvedValue({ user: { id: boardId, isBoardMember: true } });

            const res = await PlansPost(nextReq('http://localhost', {
                method: 'POST',
                body: JSON.stringify({ programId, participantId: selfId }),
            }));
            expect(res.status).toBe(200);

            const row = await prisma.programParticipant.findUnique({
                where: { programId_personId: { programId, personId: selfId } },
            });
            expect(row?.wasOrgMemberAtApproval).toBe(false);
        });

        it("refuses to approve a plan for the board member's OWN household (conflict of interest); sysadmin overrides", async () => {
            await enroll(boardKinId, { requested: true });
            mockSession.mockResolvedValue({ user: { id: boardId, isBoardMember: true } });
            const res = await PlansPost(nextReq('http://localhost', {
                method: 'POST',
                body: JSON.stringify({ programId, participantId: boardKinId }),
            }));
            expect(res.status).toBe(403);
            let row = await prisma.programParticipant.findUnique({
                where: { programId_personId: { programId, personId: boardKinId } },
            });
            expect(row?.status).toBe('PENDING'); // unchanged — nothing approved

            // Sysadmin is the deliberate remedy.
            mockSession.mockResolvedValue({ user: { id: boardId, isSysadmin: true } });
            const ok = await PlansPost(nextReq('http://localhost', {
                method: 'POST',
                body: JSON.stringify({ programId, participantId: boardKinId }),
            }));
            expect(ok.status).toBe(200);
            row = await prisma.programParticipant.findUnique({
                where: { programId_personId: { programId, personId: boardKinId } },
            });
            expect(row?.status).toBe('ACTIVE');
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
            await prisma.programParticipant.deleteMany({ where: { programId, personId: otherId } });
            mockSession.mockResolvedValue({ user: { id: boardId, isBoardMember: true } });
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
                where: { programId_personId: { programId, personId: selfId } },
            });
            expect(row?.isPaymentPlanRequested).toBe(false);
        });

        it('200 when the participant requests their own payment plan', async () => {
            await enroll(selfId, { requested: false });
            mockSession.mockResolvedValue({ user: { id: selfId } });
            const res = await RequestPost(requestReq({ participantId: selfId }), params(programId));
            expect(res.status).toBe(200);

            const row = await prisma.programParticipant.findUnique({
                where: { programId_personId: { programId, personId: selfId } },
            });
            expect(row?.isPaymentPlanRequested).toBe(true);
        });

        it('409 when the enrollment is not awaiting payment (already ACTIVE)', async () => {
            await prisma.programParticipant.upsert({
                where: { programId_personId: { programId, personId: selfId } },
                update: { status: 'ACTIVE', isPaymentPlanRequested: false },
                create: { programId, personId: selfId, status: 'ACTIVE', isPaymentPlanRequested: false },
            });
            mockSession.mockResolvedValue({ user: { id: selfId } });
            const res = await RequestPost(requestReq({ participantId: selfId }), params(programId));
            expect(res.status).toBe(409);

            const row = await prisma.programParticipant.findUnique({
                where: { programId_personId: { programId, personId: selfId } },
            });
            expect(row?.isPaymentPlanRequested).toBe(false);
        });
    });

    describe('Composed: scholarship holds a capacity seat with no Shopify involvement', () => {
        it('enroll (PENDING) -> request plan -> board approves -> ACTIVE, seat held, no fetch fires', async () => {
            const scholarshipProgram = await prisma.program.create({
                data: {
                    name: `PP Scholarship Program ${TAG}`,
                    enrollmentStatus: 'OPEN',
                    maxParticipants: 1,
                    orgMemberPriceCents: 1000,
                    nonOrgMemberPriceCents: 1500,
                },
            });

            const fetchSpy = jest.spyOn(global, 'fetch');

            try {
                // 1. Participant enrolls — paid program, so lands PENDING and
                // occupies the single capacity slot (capacity counts ALL statuses).
                mockSession.mockResolvedValue({ user: { id: selfId } });
                const enrollRes = await ParticipantsPost(
                    new Request(`http://localhost/api/programs/${scholarshipProgram.id}/participants`, {
                        method: 'POST',
                        body: JSON.stringify({ participantId: selfId }),
                    }) as unknown as import('next/server').NextRequest,
                    { params: Promise.resolve({ id: String(scholarshipProgram.id) }) },
                );
                expect(enrollRes.status).toBe(200);
                expect((await enrollRes.json()).enrollment.status).toBe('PENDING');

                // 2. Participant requests a scholarship / payment plan.
                const requestRes = await RequestPost(
                    requestReq({ participantId: selfId }),
                    { params: Promise.resolve({ id: String(scholarshipProgram.id) }) },
                );
                expect(requestRes.status).toBe(200);

                // 3. Board approves via finance-ops — no Shopify checkout involved.
                mockSession.mockResolvedValue({ user: { id: boardId, isBoardMember: true } });
                const approveRes = await PlansPost(
                    new Request('http://localhost', {
                        method: 'POST',
                        body: JSON.stringify({ programId: scholarshipProgram.id, participantId: selfId }),
                    }) as unknown as import('next/server').NextRequest,
                );
                expect(approveRes.status).toBe(200);

                const row = await prisma.programParticipant.findUnique({
                    where: { programId_personId: { programId: scholarshipProgram.id, personId: selfId } },
                });
                expect(row?.status).toBe('ACTIVE');
                expect(fetchSpy).not.toHaveBeenCalled();

                // 4. Capacity still holds: a second enrollee is rejected while the
                // scholarship seat counts against maxParticipants.
                mockSession.mockResolvedValue({ user: { id: otherId } });
                const secondRes = await ParticipantsPost(
                    new Request(`http://localhost/api/programs/${scholarshipProgram.id}/participants`, {
                        method: 'POST',
                        body: JSON.stringify({ participantId: otherId }),
                    }) as unknown as import('next/server').NextRequest,
                    { params: Promise.resolve({ id: String(scholarshipProgram.id) }) },
                );
                expect(secondRes.status).toBe(400);
                expect((await secondRes.json()).error).toMatch(/maximum capacity/);
            } finally {
                fetchSpy.mockRestore();
                await prisma.programParticipant.deleteMany({ where: { programId: scholarshipProgram.id } });
                await prisma.program.delete({ where: { id: scholarshipProgram.id } });
            }
        });
    });
});
