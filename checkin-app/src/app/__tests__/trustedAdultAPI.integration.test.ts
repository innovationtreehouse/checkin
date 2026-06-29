/**
 * @jest-environment node
 */
/**
 * Integration tests for the Trusted Adults API: household-scoped disclosure, the
 * board-only decision gate (approve needs a shared note), the household "mine"
 * view, and — the heart of the feature — the operational view where keyholders
 * (global) and program leads see the board's shared note but NEVER the family's
 * board-facing context.
 */

import { POST as CREATE } from '@/app/api/trusted-adults/route';
import { GET as MINE } from '@/app/api/trusted-adults/mine/route';
import { GET as OPERATIONAL } from '@/app/api/trusted-adults/operational/route';
import { POST as DECISION } from '@/app/api/admin/trusted-adults/decision/route';
import { POST as OVERRIDE } from '@/app/api/admin/trusted-adults/override/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { expectAuditRow, auditJson } from '@/test-helpers/expectAuditRow';

jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/email', () => ({ sendEmail: jest.fn().mockResolvedValue(true) }));

const TAG = 'trustedadult-api-test';
const SHARED = 'Grandma may pick up the kids.';

function as(id: number, householdId: number, roles: { boardMember?: boolean; sysadmin?: boolean; keyholder?: boolean } = {}) {
    (getServerSession as jest.Mock).mockResolvedValue({
        user: { id, householdId, sysadmin: false, boardMember: false, keyholder: false, backgroundCheckReviewer: false, ...roles },
    });
}
function post(url: string, body: unknown) {
    return new Request(`http://localhost:4000${url}`, { method: 'POST', body: JSON.stringify(body) }) as never;
}
function get(url: string) {
    return new Request(`http://localhost:4000${url}`) as never;
}

describe('Trusted Adults API', () => {
    let familyHh = 0, leadId = 0, childId = 0;
    let boardId = 0, boardHh = 0;
    let keyholderId = 0, keyholderHh = 0;
    let programLeadId = 0, programLeadHh = 0;
    let outsiderId = 0, outsiderHh = 0;
    let programId = 0;

    async function wipe() {
        const hhs = await prisma.household.findMany({ where: { name: { contains: TAG } }, select: { id: true } });
        const ids = hhs.map((h) => h.id);
        if (ids.length) {
            await prisma.trustedAdultReview.deleteMany({ where: { householdId: { in: ids } } });
            await prisma.trustedAdult.deleteMany({ where: { householdId: { in: ids } } });
            const parts = await prisma.participant.findMany({ where: { householdId: { in: ids } }, select: { id: true } });
            const pids = parts.map((p) => p.id);
            await prisma.programParticipant.deleteMany({ where: { participantId: { in: pids } } });
            await prisma.program.deleteMany({ where: { name: { contains: TAG } } });
            await prisma.householdLead.deleteMany({ where: { householdId: { in: ids } } });
            await prisma.participant.deleteMany({ where: { householdId: { in: ids } } });
        }
        await prisma.household.deleteMany({ where: { id: { in: ids } } });
    }

    beforeAll(async () => {
        await wipe();
        const fhh = await prisma.household.create({ data: { name: `Family HH ${TAG}` } });
        familyHh = fhh.id;
        leadId = (await prisma.participant.create({ data: { name: 'Lead', householdId: familyHh } })).id;
        await prisma.householdLead.create({ data: { householdId: familyHh, participantId: leadId } });
        childId = (await prisma.participant.create({ data: { name: 'Child', householdId: familyHh } })).id;

        boardHh = (await prisma.household.create({ data: { name: `Board HH ${TAG}` } })).id;
        boardId = (await prisma.participant.create({ data: { name: 'Board', boardMember: true, householdId: boardHh } })).id;
        keyholderHh = (await prisma.household.create({ data: { name: `Key HH ${TAG}` } })).id;
        keyholderId = (await prisma.participant.create({ data: { name: 'Key', keyholder: true, householdId: keyholderHh } })).id;
        programLeadHh = (await prisma.household.create({ data: { name: `PL HH ${TAG}` } })).id;
        programLeadId = (await prisma.participant.create({ data: { name: 'PL', householdId: programLeadHh } })).id;
        outsiderHh = (await prisma.household.create({ data: { name: `Out HH ${TAG}` } })).id;
        outsiderId = (await prisma.participant.create({ data: { name: 'Out', householdId: outsiderHh } })).id;

        // Program led by programLeadId with the family's child enrolled.
        const prog = await prisma.program.create({ data: { name: `Prog ${TAG}`, leadMentorId: programLeadId } });
        programId = prog.id;
        await prisma.programParticipant.create({ data: { programId, participantId: childId, status: 'ACTIVE' } });
    });

    afterAll(async () => {
        await wipe();
        await prisma.$disconnect();
    });

    it('defaults the household to the caller and returns 201', async () => {
        as(leadId, familyHh);
        const res = await CREATE(post('/api/trusted-adults', { counterpartyName: 'Grandma', counterpartyContact: '555-0100', familyContext: 'Maternal grandmother.' }));
        expect(res.status).toBe(201);
        const ta = await prisma.trustedAdult.findFirst({ where: { householdId: familyHh }, include: { reviews: true } });
        expect(ta?.origin).toBe('SELF_DISCLOSED');
        expect(ta?.reviews[0].status).toBe('PENDING_BOARD_REVIEW');
    });

    it('forbids a non-staff member disclosing for a different household', async () => {
        as(leadId, familyHh);
        const res = await CREATE(post('/api/trusted-adults', { householdId: boardHh, counterpartyName: 'X', counterpartyContact: 'x', familyContext: 'x' }));
        expect(res.status).toBe(403);
    });

    it('approve needs a shared note; non-board is rejected', async () => {
        const ta = await prisma.trustedAdult.findFirst({ where: { householdId: familyHh }, include: { reviews: true } });
        const reviewId = ta!.reviews[0].id;

        as(leadId, familyHh); // not board
        expect((await DECISION(post('/api/admin/trusted-adults/decision', { reviewId, decision: 'APPROVE', sharedNote: SHARED }))).status).toBe(403);

        as(boardId, boardHh, { boardMember: true });
        expect((await DECISION(post('/api/admin/trusted-adults/decision', { reviewId, decision: 'APPROVE' }))).status).toBe(400);
        const ok = await DECISION(post('/api/admin/trusted-adults/decision', { reviewId, decision: 'APPROVE', sharedNote: SHARED }));
        expect(ok.status).toBe(200);
        expect((await ok.json()).status).toBe('APPROVED');
    });

    it('the family sees familyContext + the board shared note, not internal fields', async () => {
        as(leadId, familyHh);
        const body = await (await MINE(get('/api/trusted-adults/mine'))).json();
        const ta = body.trustedAdults[0];
        expect(ta.familyContext).toBeDefined();
        expect(ta.reviews[0].sharedNote).toBe(SHARED);
        expect(ta.origin).toBeUndefined();
        expect(ta.reviews[0].decisionNote).toBeUndefined();
    });

    it('operational view: keyholder sees the shared note but NOT familyContext', async () => {
        as(keyholderId, keyholderHh, { keyholder: true });
        const body = await (await OPERATIONAL(get('/api/trusted-adults/operational'))).json();
        const row = body.trustedAdults.find((t: { householdId: number }) => t.householdId === familyHh);
        expect(row).toBeTruthy();
        expect(row.counterpartyName).toBe('Grandma');
        expect(row.reviews[0].sharedNote).toBe(SHARED);
        expect(row.familyContext).toBeUndefined(); // pii — never to keyholders
    });

    it('operational view: program lead of the household\'s child sees the shared note, not familyContext', async () => {
        as(programLeadId, programLeadHh);
        const body = await (await OPERATIONAL(get('/api/trusted-adults/operational'))).json();
        const row = body.trustedAdults.find((t: { householdId: number }) => t.householdId === familyHh);
        expect(row).toBeTruthy();
        expect(row.reviews[0].sharedNote).toBe(SHARED);
        expect(row.familyContext).toBeUndefined();
    });

    it('operational view: an unrelated member sees nothing', async () => {
        as(outsiderId, outsiderHh);
        const body = await (await OPERATIONAL(get('/api/trusted-adults/operational'))).json();
        const row = body.trustedAdults.find((t: { householdId: number }) => t.householdId === familyHh);
        expect(row).toBeUndefined();
    });

    it('board decision + override bind the actor on the review AND the TrustedAdult audit', async () => {
        // Fresh disclosure so this runs independently of the approve test's review.
        const ta = await prisma.trustedAdult.create({
            data: {
                householdId: familyHh, counterpartyName: 'Grandpa', counterpartyContact: '555-0200',
                familyContext: 'Paternal grandfather.', origin: 'SELF_DISCLOSED', disclosedById: leadId,
                reviews: { create: { householdId: familyHh, kind: 'INITIAL', status: 'PENDING_BOARD_REVIEW' } },
            },
            include: { reviews: true },
        });
        const reviewId = ta.reviews[0].id;

        // Decision route, end-to-end as a board member.
        as(boardId, boardHh, { boardMember: true });
        const res = await DECISION(post('/api/admin/trusted-adults/decision', { reviewId, decision: 'APPROVE', sharedNote: SHARED }));
        expect(res.status).toBe(200);

        expect((await prisma.trustedAdultReview.findUnique({ where: { id: reviewId } }))?.decidedById).toBe(boardId);
        const decisionLog = await expectAuditRow(prisma, { action: 'EDIT', tableName: 'TrustedAdult', affectedEntityId: ta.id });
        expect(decisionLog.actorId).toBe(boardId);
        expect(auditJson(decisionLog.newData).decision).toBe('APPROVE');

        // Override negative: force-approve with no shared note -> 400 (STATUS_FOR[bad_input]).
        as(boardId, boardHh, { boardMember: true });
        expect((await OVERRIDE(post('/api/admin/trusted-adults/override', { reviewId, action: 'approve' }))).status).toBe(400);

        // Override route binds the same board actor on the review + a fresh audit row.
        const ok = await OVERRIDE(post('/api/admin/trusted-adults/override', { reviewId, action: 'approve', sharedNote: SHARED }));
        expect(ok.status).toBe(200);
        expect((await prisma.trustedAdultReview.findUnique({ where: { id: reviewId } }))?.decidedById).toBe(boardId);
        const overrideLog = await expectAuditRow(prisma, { action: 'EDIT', tableName: 'TrustedAdult', affectedEntityId: ta.id });
        expect(overrideLog.actorId).toBe(boardId);
        expect(auditJson(overrideLog.newData).override).toBe('approve');
    });
});
