/**
 * @jest-environment node
 */
/**
 * Integration tests for the membership payment-plan routes:
 *   GET  /api/finance-ops/membership-payment-plans        (board-only queue)
 *   POST /api/finance-ops/membership-payment-plans         (board approves -> certify/activate)
 *   POST /api/finance-ops/membership-payment-plans/refuse  (board denies -> clear flag, stay PENDING_PAYMENT)
 *   POST /api/membership/request-payment-plan              (request, with IDOR guard)
 *
 * Covers auth rejections (401/403), validation (400/404), the wrong-phase gate
 * (409 off PENDING_PAYMENT), the IDOR path (an unrelated authenticated user
 * requesting on another household's membership), and the successful transitions
 * (flag set on request; certify -> ACTIVE + flag cleared + audit on approve).
 */
import { GET as PlansGet, POST as PlansPost } from '@/app/api/finance-ops/membership-payment-plans/route';
import { POST as DenyPost } from '@/app/api/finance-ops/membership-payment-plans/refuse/route';
import { POST as RequestPost } from '@/app/api/membership/request-payment-plan/route';
import prisma from '@/lib/prisma';

jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/email');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mockSession = require('next-auth/next').getServerSession;
// `@/lib/email`'s real module has no __getSentEmails/__clearSentEmails — those
// only exist on the manual mock (src/lib/__mocks__/email.ts) that jest.mock
// above swaps in. jest.requireMock (not a direct import) fetches that swapped
// instance so this typechecks against the mock's own shape.
const { __getSentEmails, __clearSentEmails } =
    jest.requireMock<typeof import('@/lib/__mocks__/email')>('@/lib/email');

const TAG = 'membership-payment-plans-test';

function nextReq(url = 'http://localhost/api/finance-ops/membership-payment-plans', init?: RequestInit) {
    return new Request(url, init) as unknown as import('next/server').NextRequest;
}
function requestReq(body: unknown) {
    return new Request('http://localhost/api/membership/request-payment-plan', {
        method: 'POST',
        body: JSON.stringify(body),
    }) as unknown as import('next/server').NextRequest;
}

describe('Membership payment-plan routes', () => {
    let boardId: number;
    let leadId: number;
    let otherId: number;
    // A process the lead's household owns, PENDING_PAYMENT + bgCleared so approval activates.
    let leadProcessId: number;
    let leadMembershipId: number;

    let seq = 0;
    async function makeProc(label: string, opts: { requested: boolean; status?: 'PENDING_PAYMENT' | 'PENDING_BG_REVIEW'; withLead?: boolean }) {
        const n = seq++;
        const hh = await prisma.household.create({ data: { name: `${label}-${n} ${TAG}` } });
        let personId: number | undefined;
        if (opts.withLead) {
            const lead = await prisma.person.create({ data: { email: `lead-${label}-${n}-${TAG}@example.com`, name: 'Lead', householdId: hh.id } });
            await prisma.person.update({ where: { id: lead.id }, data: { isHouseholdLead: true } });
            personId = lead.id;
        }
        const m = await prisma.orgMembership.create({ data: { householdId: hh.id, status: 'NONE', isVolunteer: false } });
        const p = await prisma.orgMembershipProcess.create({
            data: {
                orgMembershipId: m.id,
                kind: 'INITIAL',
                status: opts.status ?? 'PENDING_PAYMENT',
                bgClearedAt: new Date(),
                isPaymentPlanRequested: opts.requested,
            },
        });
        return { householdId: hh.id, orgMembershipId: m.id, processId: p.id, personId };
    }

    async function wipe() {
        const hhs = await prisma.household.findMany({ where: { name: { contains: TAG } }, select: { id: true } });
        const ids = hhs.map((h) => h.id);
        if (ids.length) {
            await prisma.orgMembershipProcess.deleteMany({ where: { orgMembership: { householdId: { in: ids } } } });
            await prisma.orgMembership.deleteMany({ where: { householdId: { in: ids } } });
            await prisma.person.deleteMany({ where: { householdId: { in: ids } } });
            await prisma.household.deleteMany({ where: { id: { in: ids } } });
        }
        await prisma.person.deleteMany({ where: { email: { contains: TAG } } });
    }

    beforeAll(async () => {
        await wipe();

        const board = await prisma.person.create({
            data: { name: 'MPP Board', email: `board-${TAG}@example.com`, isBoardMember: true, household: { create: { name: `Board ${TAG}` } } },
        });
        boardId = board.id;
        const other = await prisma.person.create({
            data: { name: 'MPP Other', email: `other-${TAG}@example.com`, household: { create: { name: `Other ${TAG}` } } },
        });
        otherId = other.id;
    });

    beforeEach(async () => {
        jest.clearAllMocks();
        __clearSentEmails();
        // Fresh requested + PENDING_PAYMENT process owned by a household lead each
        // test (the approve test mutates it to ACTIVE, so it can't be shared).
        const proc = await makeProc('Lead', { requested: true, withLead: true });
        leadProcessId = proc.processId;
        leadMembershipId = proc.orgMembershipId;
        leadId = proc.personId!;
    });

    afterAll(async () => {
        await wipe();
        await prisma.$disconnect();
    });

    describe('GET /api/finance-ops/membership-payment-plans', () => {
        it('401 without a session', async () => {
            mockSession.mockResolvedValue(null);
            expect((await PlansGet(nextReq())).status).toBe(401);
        });

        it('403 for a non-board, non-sysadmin user', async () => {
            mockSession.mockResolvedValue({ user: { id: otherId } });
            expect((await PlansGet(nextReq())).status).toBe(403);
        });

        it('returns only PENDING_PAYMENT + requested rows to a board member', async () => {
            const notRequested = await makeProc('NoiseUnrequested', { requested: false });
            const wrongPhase = await makeProc('NoiseWrongPhase', { requested: true, status: 'PENDING_BG_REVIEW' });
            mockSession.mockResolvedValue({ user: { id: boardId, isBoardMember: true } });

            const res = await PlansGet(nextReq());
            expect(res.status).toBe(200);
            const ids = (await res.json()).map((r: { id: number }) => r.id);
            expect(ids).toContain(leadProcessId);
            expect(ids).not.toContain(notRequested.processId);
            expect(ids).not.toContain(wrongPhase.processId);
        });
    });

    describe('POST /api/finance-ops/membership-payment-plans (approve)', () => {
        it('401 without a session', async () => {
            mockSession.mockResolvedValue(null);
            expect((await PlansPost(nextReq('http://localhost', { method: 'POST', body: '{}' }))).status).toBe(401);
        });

        it('403 for a non-board user', async () => {
            mockSession.mockResolvedValue({ user: { id: otherId } });
            const res = await PlansPost(nextReq('http://localhost', { method: 'POST', body: JSON.stringify({ processId: leadProcessId }) }));
            expect(res.status).toBe(403);
        });

        it('400 when reason is missing', async () => {
            mockSession.mockResolvedValue({ user: { id: boardId, isBoardMember: true } });
            const res = await PlansPost(nextReq('http://localhost', { method: 'POST', body: JSON.stringify({ processId: leadProcessId }) }));
            expect(res.status).toBe(400);

            const res2 = await PlansPost(nextReq('http://localhost', { method: 'POST', body: JSON.stringify({ processId: leadProcessId, reason: '   ' }) }));
            expect(res2.status).toBe(400);

            const proc = await prisma.orgMembershipProcess.findUnique({ where: { id: leadProcessId } });
            expect(proc?.status).toBe('PENDING_PAYMENT');
        });

        it('409 when there is no pending request for the process', async () => {
            const cleared = await makeProc('Cleared', { requested: false });
            mockSession.mockResolvedValue({ user: { id: boardId, isBoardMember: true } });
            const res = await PlansPost(nextReq('http://localhost', { method: 'POST', body: JSON.stringify({ processId: cleared.processId, reason: 'Board approved scholarship' }) }));
            expect(res.status).toBe(409);
        });

        it('board approval activates the membership, clears the flag, and writes an audit row', async () => {
            mockSession.mockResolvedValue({ user: { id: boardId, isBoardMember: true } });
            const res = await PlansPost(nextReq('http://localhost', { method: 'POST', body: JSON.stringify({ processId: leadProcessId, reason: 'Board approved scholarship' }) }));
            expect(res.status).toBe(200);

            const proc = await prisma.orgMembershipProcess.findUnique({ where: { id: leadProcessId } });
            expect(proc?.status).toBe('ACTIVE'); // bgClearedAt was set, so certify -> ACTIVE
            expect(proc?.isPaymentPlanRequested).toBe(false);
            expect(proc?.certifiedById).toBe(boardId);
            expect(proc?.certificationNote).toBe('Board approved scholarship');

            const membership = await prisma.orgMembership.findUnique({ where: { id: leadMembershipId } });
            expect(membership?.status).toBe('ACTIVE');

            const audits = await prisma.auditLog.findMany({
                where: { tableName: 'OrgMembershipProcess', affectedEntityId: leadProcessId, actorId: boardId },
                orderBy: { id: 'asc' },
            });
            expect(audits.length).toBeGreaterThan(0);
            // Written inside activate() (via certifyPaymentPlan) — carries the reason.
            const certifyAudit = audits.find(a => (a.newData as { via?: string })?.via === 'certified');
            expect(certifyAudit).toBeTruthy();
            expect((certifyAudit!.newData as { certificationNote?: string }).certificationNote).toBe('Board approved scholarship');
            // Supplementary marker written by the route itself.
            const approvedAudit = audits.find(a => (a.newData as { paymentPlanApproved?: boolean })?.paymentPlanApproved === true);
            expect(approvedAudit).toBeTruthy();
        });
    });

    describe('POST /api/finance-ops/membership-payment-plans/refuse (deny)', () => {
        const denyReq = (body: unknown) => new Request('http://localhost/api/finance-ops/membership-payment-plans/refuse', {
            method: 'POST',
            body: JSON.stringify(body),
        }) as unknown as import('next/server').NextRequest;

        it('401 without a session', async () => {
            mockSession.mockResolvedValue(null);
            expect((await DenyPost(denyReq({ processId: leadProcessId }))).status).toBe(401);
        });

        it('403 for a non-board user', async () => {
            mockSession.mockResolvedValue({ user: { id: otherId } });
            expect((await DenyPost(denyReq({ processId: leadProcessId }))).status).toBe(403);
        });

        it('400 when processId is missing', async () => {
            mockSession.mockResolvedValue({ user: { id: boardId, isBoardMember: true } });
            expect((await DenyPost(denyReq({}))).status).toBe(400);
        });

        it('409 when there is no pending request for the process', async () => {
            const cleared = await makeProc('DenyCleared', { requested: false });
            mockSession.mockResolvedValue({ user: { id: boardId, isBoardMember: true } });
            expect((await DenyPost(denyReq({ processId: cleared.processId }))).status).toBe(409);
        });

        it('board denial clears the flag, keeps the process PENDING_PAYMENT, and writes an audit row', async () => {
            mockSession.mockResolvedValue({ user: { id: boardId, isBoardMember: true } });
            const res = await DenyPost(denyReq({ processId: leadProcessId }));
            expect(res.status).toBe(200);

            const proc = await prisma.orgMembershipProcess.findUnique({ where: { id: leadProcessId } });
            expect(proc?.isPaymentPlanRequested).toBe(false);
            expect(proc?.status).toBe('PENDING_PAYMENT'); // stays awaiting payment — no seat, no grace, pay-to-activate
            expect(proc?.certifiedById).toBeNull(); // denial never certifies/activates

            const membership = await prisma.orgMembership.findUnique({ where: { id: leadMembershipId } });
            expect(membership?.status).toBe('NONE'); // untouched by denial

            const audits = await prisma.auditLog.findMany({
                where: { tableName: 'OrgMembershipProcess', affectedEntityId: leadProcessId, actorId: boardId },
            });
            expect(audits.some(a => (a.newData as { paymentPlanDenied?: boolean })?.paymentPlanDenied === true)).toBe(true);
        });

        it('a re-deny of an already-denied (flag false) process is a 409 no-op', async () => {
            mockSession.mockResolvedValue({ user: { id: boardId, isBoardMember: true } });
            expect((await DenyPost(denyReq({ processId: leadProcessId }))).status).toBe(200);
            expect((await DenyPost(denyReq({ processId: leadProcessId }))).status).toBe(409);
        });
    });

    describe('POST /api/membership/request-payment-plan', () => {
        it('401 without a session', async () => {
            mockSession.mockResolvedValue(null);
            expect((await RequestPost(requestReq({ processId: leadProcessId }))).status).toBe(401);
        });

        it('400 when processId is missing', async () => {
            mockSession.mockResolvedValue({ user: { id: leadId } });
            expect((await RequestPost(requestReq({}))).status).toBe(400);
        });

        it('404 for a non-existent process', async () => {
            mockSession.mockResolvedValue({ user: { id: boardId, isBoardMember: true } });
            expect((await RequestPost(requestReq({ processId: 999999999 }))).status).toBe(404);
        });

        it('403 (IDOR) when an unrelated user requests on another household\'s membership', async () => {
            const fresh = await makeProc('IdorTarget', { requested: false, withLead: true });
            mockSession.mockResolvedValue({ user: { id: otherId } }); // not board, not this household's lead
            const res = await RequestPost(requestReq({ processId: fresh.processId }));
            expect(res.status).toBe(403);

            const proc = await prisma.orgMembershipProcess.findUnique({ where: { id: fresh.processId } });
            expect(proc?.isPaymentPlanRequested).toBe(false);
        });

        it('409 when the process is not awaiting payment', async () => {
            const bg = await makeProc('WrongPhaseReq', { requested: false, status: 'PENDING_BG_REVIEW', withLead: true });
            mockSession.mockResolvedValue({ user: { id: bg.personId } });
            const res = await RequestPost(requestReq({ processId: bg.processId }));
            expect(res.status).toBe(409);

            const proc = await prisma.orgMembershipProcess.findUnique({ where: { id: bg.processId } });
            expect(proc?.isPaymentPlanRequested).toBe(false);
        });

        it('200 when a household lead requests their own payment plan', async () => {
            const fresh = await makeProc('LeadSelfReq', { requested: false, withLead: true });
            mockSession.mockResolvedValue({ user: { id: fresh.personId } });
            const res = await RequestPost(requestReq({ processId: fresh.processId }));
            expect(res.status).toBe(200);

            const proc = await prisma.orgMembershipProcess.findUnique({ where: { id: fresh.processId } });
            expect(proc?.isPaymentPlanRequested).toBe(true);
        });

        it('200 when a board member requests on any household', async () => {
            const fresh = await makeProc('BoardReq', { requested: false, withLead: true });
            mockSession.mockResolvedValue({ user: { id: boardId, isBoardMember: true } });
            const res = await RequestPost(requestReq({ processId: fresh.processId }));
            expect(res.status).toBe(200);

            const proc = await prisma.orgMembershipProcess.findUnique({ where: { id: fresh.processId } });
            expect(proc?.isPaymentPlanRequested).toBe(true);
        });
    });

    describe('email behavior', () => {
        it('a fresh request sends the review-team notify and the household ack, each once', async () => {
            const fresh = await makeProc('EmailFreshReq', { requested: false, withLead: true });
            mockSession.mockResolvedValue({ user: { id: fresh.personId } });

            const res = await RequestPost(requestReq({ processId: fresh.processId }));
            expect(res.status).toBe(200);

            const sent = __getSentEmails();
            expect(sent.filter((e) => e.subject.includes('New membership scholarship'))).toHaveLength(1);
            expect(sent.filter((e) => e.subject === 'We received your scholarship / payment-plan request')).toHaveLength(1);
        });

        it('a no-op re-POST (already requested) sends zero emails', async () => {
            // leadProcessId was seeded with requested:true in beforeEach.
            mockSession.mockResolvedValue({ user: { id: leadId } });

            const res = await RequestPost(requestReq({ processId: leadProcessId }));
            expect(res.status).toBe(200);
            expect(__getSentEmails()).toHaveLength(0);
        });

        // User decision: an applicant receives EXACTLY ONE automatic email (the
        // request ack, covered above). Certify/approve sends NO automatic email —
        // the board communicates decisions manually — even though leadProcessId's
        // household lead (a gate-worthy recipient) exists.
        it('certify (approve) sends no automatic email', async () => {
            mockSession.mockResolvedValue({ user: { id: boardId, isBoardMember: true } });

            __clearSentEmails();
            const res = await PlansPost(nextReq('http://localhost', { method: 'POST', body: JSON.stringify({ processId: leadProcessId, reason: 'Board approved scholarship' }) }));
            expect(res.status).toBe(200);

            expect(__getSentEmails()).toHaveLength(0);
        });

        // Deny is silent like approve (item 2): no automatic applicant email —
        // the board communicates the outcome manually. leadProcessId's household
        // lead exists (a would-be recipient), yet nothing is sent.
        it('deny sends no automatic email', async () => {
            const denyReq = new Request('http://localhost/api/finance-ops/membership-payment-plans/refuse', {
                method: 'POST',
                body: JSON.stringify({ processId: leadProcessId }),
            }) as unknown as import('next/server').NextRequest;
            mockSession.mockResolvedValue({ user: { id: boardId, isBoardMember: true } });

            __clearSentEmails();
            const res = await DenyPost(denyReq);
            expect(res.status).toBe(200);
            expect(__getSentEmails()).toHaveLength(0);
        });
    });
});
