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
import { POST as RefusePost } from '@/app/api/finance-ops/payment-plans/refuse/route';
import { POST as RequestPost } from '@/app/api/programs/[id]/request-payment-plan/route';
import { POST as ParticipantsPost, DELETE as ParticipantsDelete } from '@/app/api/programs/[id]/participants/route';
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

            // No Shopify variant on this program — capacity propagation never engages.
            const data = await res.json();
            expect(data.warning).toBeUndefined();
        });

        // Hold-ledger (product decision 2026-07-06): the seat is decremented at
        // APPLICATION time (request-payment-plan), NOT at approval — approval
        // only stops billing the applicant and CONSUMES the hold (clears
        // inventoryHeldAt with no +1), so a later removal of this now-ACTIVE
        // comped participant must not release a seat that was never given back
        // to Shopify. Proven here by NO fetch firing at either step even though
        // the program has a variant configured.
        it('does NOT touch Shopify on approval (hold consumed, not released), and a later removal fires no +1', async () => {
            const fetchSpy = jest.spyOn(global, 'fetch');
            const shopifyProgram = await prisma.program.create({
                data: {
                    name: `PP Shopify Program ${TAG}`,
                    leadMentorId: mentorId,
                    enrollmentStatus: 'OPEN',
                    shopifyVariantId: 'dev-mock-variant-pp',
                },
            });
            try {
                await prisma.programParticipant.upsert({
                    where: { programId_personId: { programId: shopifyProgram.id, personId: selfId } },
                    update: { status: 'PENDING', isPaymentPlanRequested: true, pendingSince: new Date(), inventoryHeldAt: new Date() },
                    create: { programId: shopifyProgram.id, personId: selfId, status: 'PENDING', isPaymentPlanRequested: true, pendingSince: new Date(), inventoryHeldAt: new Date() },
                });
                mockSession.mockResolvedValue({ user: { id: boardId, isBoardMember: true } });

                const res = await PlansPost(nextReq('http://localhost', {
                    method: 'POST',
                    body: JSON.stringify({ programId: shopifyProgram.id, participantId: selfId }),
                }));
                expect(res.status).toBe(200);
                const data = await res.json();
                expect(data.warning).toBeUndefined();

                const row = await prisma.programParticipant.findUnique({
                    where: { programId_personId: { programId: shopifyProgram.id, personId: selfId } },
                });
                expect(row?.status).toBe('ACTIVE');
                expect(row?.inventoryHeldAt).toBeNull(); // hold consumed
                expect(fetchSpy).not.toHaveBeenCalled();

                // Later removal of the now-ACTIVE comped participant: no hold left
                // to release, so no +1 fires.
                mockSession.mockResolvedValue({ user: { id: boardId, isBoardMember: true } });
                const delRes = await ParticipantsDelete(
                    new Request(`http://localhost/api/programs/${shopifyProgram.id}/participants`, {
                        method: 'DELETE',
                        body: JSON.stringify({ participantId: selfId }),
                    }) as unknown as import('next/server').NextRequest,
                    { params: Promise.resolve({ id: String(shopifyProgram.id) }) },
                );
                expect(delRes.status).toBe(200);
                expect((await delRes.json()).warning).toBeUndefined();
                expect(fetchSpy).not.toHaveBeenCalled();
            } finally {
                fetchSpy.mockRestore();
                await prisma.programParticipant.deleteMany({ where: { programId: shopifyProgram.id } });
                await prisma.program.delete({ where: { id: shopifyProgram.id } });
            }
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

        // Scholarship lifecycle drives inventory (product decision 2026-07-06):
        // APPLICATION decrements Shopify by 1 — only on the false->true transition.
        describe('Shopify inventory (apply time)', () => {
            let shopifyProgramId: number;

            beforeAll(async () => {
                const p = await prisma.program.create({
                    data: { name: `PP Apply Shopify Program ${TAG}`, enrollmentStatus: 'OPEN', shopifyVariantId: 'dev-mock-variant-apply-pp' },
                });
                shopifyProgramId = p.id;
            });

            afterAll(async () => {
                await prisma.programParticipant.deleteMany({ where: { programId: shopifyProgramId } });
                await prisma.program.delete({ where: { id: shopifyProgramId } });
            });

            it('decrements the single-pool variant by 1 on the false->true transition', async () => {
                const prevCheckinEnv = process.env.CHECKIN_ENV;
                process.env.CHECKIN_ENV = 'local';
                const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
                try {
                    await prisma.programParticipant.upsert({
                        where: { programId_personId: { programId: shopifyProgramId, personId: selfId } },
                        update: { status: 'PENDING', isPaymentPlanRequested: false, pendingSince: new Date() },
                        create: { programId: shopifyProgramId, personId: selfId, status: 'PENDING', isPaymentPlanRequested: false, pendingSince: new Date() },
                    });
                    mockSession.mockResolvedValue({ user: { id: selfId } });

                    // CHECKIN_ENV=local also arms the keyless-kiosk fallback in
                    // authenticateRequest, which hijacks any cookie-less request as
                    // `kiosk` -> 403 before the session/role gate runs — send a cookie.
                    const req = new Request(`http://localhost/api/programs/${shopifyProgramId}/request-payment-plan`, {
                        method: 'POST',
                        headers: { cookie: 'session=test' },
                        body: JSON.stringify({ participantId: selfId }),
                    }) as unknown as import('next/server').NextRequest;
                    const res = await RequestPost(req, params(shopifyProgramId));
                    expect(res.status).toBe(200);
                    const data = await res.json();
                    expect(data.warning).toBeUndefined();

                    expect(logSpy).toHaveBeenCalledWith(
                        expect.stringContaining('Would adjust inventory by -1 for variants: dev-mock-variant-apply-pp'),
                    );
                } finally {
                    logSpy.mockRestore();
                    process.env.CHECKIN_ENV = prevCheckinEnv;
                }
            });

            it('does NOT fire a second -1 on an idempotent re-request (already requested)', async () => {
                const prevCheckinEnv = process.env.CHECKIN_ENV;
                process.env.CHECKIN_ENV = 'local';
                const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
                try {
                    await prisma.programParticipant.update({
                        where: { programId_personId: { programId: shopifyProgramId, personId: selfId } },
                        data: { isPaymentPlanRequested: true },
                    });
                    mockSession.mockResolvedValue({ user: { id: selfId } });

                    const req = new Request(`http://localhost/api/programs/${shopifyProgramId}/request-payment-plan`, {
                        method: 'POST',
                        headers: { cookie: 'session=test' },
                        body: JSON.stringify({ participantId: selfId }),
                    }) as unknown as import('next/server').NextRequest;
                    const res = await RequestPost(req, params(shopifyProgramId));
                    expect(res.status).toBe(200);
                    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('Would adjust inventory'));
                } finally {
                    logSpy.mockRestore();
                    process.env.CHECKIN_ENV = prevCheckinEnv;
                }
            });
        });
    });

    describe('POST /api/finance-ops/payment-plans/refuse', () => {
        // Cookie header: harmless when CHECKIN_ENV isn't 'local', and required for
        // the tests below that DO flip it to 'local' — see the comment on the
        // approve-endpoint's Shopify test above for why (keyless-kiosk fallback).
        const refuseReq = (body: unknown) => new Request('http://localhost/api/finance-ops/payment-plans/refuse', {
            method: 'POST',
            headers: { cookie: 'session=test' },
            body: JSON.stringify(body),
        }) as unknown as import('next/server').NextRequest;

        it('401 without a session', async () => {
            mockSession.mockResolvedValue(null);
            const res = await RefusePost(refuseReq({ programId, participantId: selfId }));
            expect(res.status).toBe(401);
        });

        it('403 for a non-board user', async () => {
            mockSession.mockResolvedValue({ user: { id: selfId } });
            const res = await RefusePost(refuseReq({ programId, participantId: selfId }));
            expect(res.status).toBe(403);
        });

        it('409 when there is no pending payment-plan request', async () => {
            await enroll(otherId, { requested: false });
            mockSession.mockResolvedValue({ user: { id: boardId, isBoardMember: true } });
            const res = await RefusePost(refuseReq({ programId, participantId: otherId }));
            expect(res.status).toBe(409);
        });

        it("refuses to refuse a plan for the board member's OWN household (conflict of interest)", async () => {
            await enroll(boardKinId, { requested: true });
            mockSession.mockResolvedValue({ user: { id: boardId, isBoardMember: true } });
            const res = await RefusePost(refuseReq({ programId, participantId: boardKinId }));
            expect(res.status).toBe(403);

            const row = await prisma.programParticipant.findUnique({
                where: { programId_personId: { programId, personId: boardKinId } },
            });
            expect(row?.isPaymentPlanRequested).toBe(true); // unchanged
        });

        it('denies a pending request: no Shopify op, hold persists, denial stamped', async () => {
            const fetchSpy = jest.spyOn(global, 'fetch');
            const shopifyProgram = await prisma.program.create({
                data: { name: `PP Refuse Shopify Program ${TAG}`, enrollmentStatus: 'OPEN', shopifyVariantId: 'dev-mock-variant-refuse-pp' },
            });
            try {
                // inventoryHeldAt set, as APPLICATION would have stamped it.
                await prisma.programParticipant.upsert({
                    where: { programId_personId: { programId: shopifyProgram.id, personId: selfId } },
                    update: { status: 'PENDING', isPaymentPlanRequested: true, pendingSince: new Date(), inventoryHeldAt: new Date() },
                    create: { programId: shopifyProgram.id, personId: selfId, status: 'PENDING', isPaymentPlanRequested: true, pendingSince: new Date(), inventoryHeldAt: new Date() },
                });
                mockSession.mockResolvedValue({ user: { id: boardId, isBoardMember: true } });

                const res = await RefusePost(refuseReq({ programId: shopifyProgram.id, participantId: selfId }));
                expect(res.status).toBe(200);
                expect((await res.json()).warning).toBeUndefined();

                const row = await prisma.programParticipant.findUnique({
                    where: { programId_personId: { programId: shopifyProgram.id, personId: selfId } },
                });
                expect(row?.isPaymentPlanRequested).toBe(false);
                expect(row?.status).toBe('PENDING'); // still holds the enrollment
                expect(row?.inventoryHeldAt).not.toBeNull(); // hold persists — no +1
                expect(row?.paymentPlanDeniedAt).not.toBeNull(); // denial stamped

                const audit = await prisma.auditLog.findFirst({
                    where: { actorId: boardId, tableName: 'ProgramParticipant', affectedEntityId: selfId, secondaryAffectedEntity: shopifyProgram.id, action: 'EDIT' },
                });
                expect(audit).not.toBeNull();

                expect(fetchSpy).not.toHaveBeenCalled(); // no Shopify op at all — this supersedes the earlier deny-time +1

                // Double-refuse: the second call finds isPaymentPlanRequested
                // already false -> 409, no-op.
                const second = await RefusePost(refuseReq({ programId: shopifyProgram.id, participantId: selfId }));
                expect(second.status).toBe(409);
                expect(fetchSpy).not.toHaveBeenCalled();
            } finally {
                fetchSpy.mockRestore();
                await prisma.programParticipant.deleteMany({ where: { programId: shopifyProgram.id } });
                await prisma.program.delete({ where: { id: shopifyProgram.id } });
            }
        });

        it('re-applies while holding after a denial: no second -1, denial stamp clears', async () => {
            const prevCheckinEnv = process.env.CHECKIN_ENV;
            process.env.CHECKIN_ENV = 'local';
            const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
            const shopifyProgram = await prisma.program.create({
                data: { name: `PP Reapply Shopify Program ${TAG}`, enrollmentStatus: 'OPEN', shopifyVariantId: 'dev-mock-variant-reapply-pp' },
            });
            const reqParams = (id: string | number) => ({ params: Promise.resolve({ id: String(id) }) });
            try {
                await prisma.programParticipant.upsert({
                    where: { programId_personId: { programId: shopifyProgram.id, personId: selfId } },
                    update: { status: 'PENDING', isPaymentPlanRequested: true, pendingSince: new Date(), inventoryHeldAt: new Date() },
                    create: { programId: shopifyProgram.id, personId: selfId, status: 'PENDING', isPaymentPlanRequested: true, pendingSince: new Date(), inventoryHeldAt: new Date() },
                });

                // Deny -> no Shopify op, hold persists, deniedAt stamped.
                mockSession.mockResolvedValue({ user: { id: boardId, isBoardMember: true } });
                const refuseRes = await RefusePost(refuseReq({ programId: shopifyProgram.id, participantId: selfId }));
                expect(refuseRes.status).toBe(200);
                expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('Would adjust inventory'));

                let row = await prisma.programParticipant.findUnique({
                    where: { programId_personId: { programId: shopifyProgram.id, personId: selfId } },
                });
                expect(row?.inventoryHeldAt).not.toBeNull();
                expect(row?.paymentPlanDeniedAt).not.toBeNull();

                // Re-apply while still holding -> flips the request flag + clears the
                // denial stamp, but does NOT fire a second -1 (inventoryHeldAt was
                // already set, so the apply-time guard's branch-1 never runs).
                logSpy.mockClear();
                mockSession.mockResolvedValue({ user: { id: selfId } });
                const reapplyRes = await RequestPost(
                    new Request(`http://localhost/api/programs/${shopifyProgram.id}/request-payment-plan`, {
                        method: 'POST',
                        headers: { cookie: 'session=test' },
                        body: JSON.stringify({ participantId: selfId }),
                    }) as unknown as import('next/server').NextRequest,
                    reqParams(shopifyProgram.id),
                );
                expect(reapplyRes.status).toBe(200);
                expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('Would adjust inventory'));

                row = await prisma.programParticipant.findUnique({
                    where: { programId_personId: { programId: shopifyProgram.id, personId: selfId } },
                });
                expect(row?.isPaymentPlanRequested).toBe(true);
                expect(row?.paymentPlanDeniedAt).toBeNull(); // denial stamp cleared
                expect(row?.inventoryHeldAt).not.toBeNull(); // still held throughout
            } finally {
                logSpy.mockRestore();
                process.env.CHECKIN_ENV = prevCheckinEnv;
                await prisma.programParticipant.deleteMany({ where: { programId: shopifyProgram.id } });
                await prisma.program.delete({ where: { id: shopifyProgram.id } });
            }
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

    // Scholarship state is board/finance-confidential: a program's volunteer lead
    // mentor must neither initiate a request nor read the hardship fields
    // (paymentPlanDeniedAt / inventoryHeldAt) off any response; and a failed
    // Shopify -1 must not leave a phantom hold behind.
    describe('confidentiality + failed-hold rollback', () => {
        const params = (id: string | number) => ({ params: Promise.resolve({ id: String(id) }) });

        it('403 when the program lead mentor requests a payment plan for a participant', async () => {
            await enroll(otherId, { requested: false });
            mockSession.mockResolvedValue({ user: { id: mentorId } });
            const res = await RequestPost(requestReq({ participantId: otherId }), params(programId));
            expect(res.status).toBe(403);
        });

        it('request and DELETE responses carry no raw participant row (no hardship fields)', async () => {
            await enroll(selfId, { requested: false });
            mockSession.mockResolvedValue({ user: { id: selfId } });

            const reqRes = await RequestPost(requestReq({ participantId: selfId }), params(programId));
            expect(reqRes.status).toBe(200);
            const reqBody = await reqRes.json();
            expect(reqBody.success).toBe(true);
            expect(reqBody.participant).toBeUndefined();

            const delRes = await ParticipantsDelete(
                new Request(`http://localhost/api/programs/${programId}/participants`, {
                    method: 'DELETE',
                    body: JSON.stringify({ participantId: selfId }),
                }) as unknown as import('next/server').NextRequest,
                params(programId),
            );
            expect(delRes.status).toBe(200);
            const delBody = await delRes.json();
            expect(delBody.success).toBe(true);
            expect(delBody.enrollment).toBeUndefined();
        });

        it('rolls the hold back when the Shopify -1 fails (no phantom hold)', async () => {
            // Default env: shopifyMockActive() is false and no credentials are
            // configured, so adjustProgramInventory returns false without throwing.
            const p = await prisma.program.create({
                data: { name: `PP Rollback Shopify Program ${TAG}`, enrollmentStatus: 'OPEN', shopifyVariantId: 'dev-mock-variant-rollback-pp' },
            });
            try {
                await prisma.programParticipant.create({
                    data: { programId: p.id, personId: selfId, status: 'PENDING', isPaymentPlanRequested: false, pendingSince: new Date() },
                });
                mockSession.mockResolvedValue({ user: { id: selfId } });

                const res = await RequestPost(
                    new Request(`http://localhost/api/programs/${p.id}/request-payment-plan`, {
                        method: 'POST',
                        body: JSON.stringify({ participantId: selfId }),
                    }) as unknown as import('next/server').NextRequest,
                    params(p.id),
                );
                expect(res.status).toBe(200);
                expect((await res.json()).warning).toMatch(/rolled back/);

                const row = await prisma.programParticipant.findUniqueOrThrow({
                    where: { programId_personId: { programId: p.id, personId: selfId } },
                });
                expect(row.inventoryHeldAt).toBeNull(); // no phantom hold
                expect(row.isPaymentPlanRequested).toBe(true); // finance request still stands
            } finally {
                await prisma.programParticipant.deleteMany({ where: { programId: p.id } });
                await prisma.program.delete({ where: { id: p.id } });
            }
        });
    });
});
