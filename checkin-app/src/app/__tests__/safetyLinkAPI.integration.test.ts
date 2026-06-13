/**
 * @jest-environment node
 */
/**
 * Integration tests for the Safety Links API surface: disclosure defaults the
 * subject to the caller, non-staff can't disclose about others, the board-only
 * decision gate, and the self-scoped "mine" view (board internal notes stripped).
 */

import { POST as CREATE } from '@/app/api/safety-links/route';
import { GET as MINE } from '@/app/api/safety-links/mine/route';
import { POST as DECISION } from '@/app/api/admin/safety-links/decision/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/email', () => ({ sendEmail: jest.fn().mockResolvedValue(true) }));

const TAG = 'safetylink-api-test';

function as(id: number, householdId: number, roles: { boardMember?: boolean; sysadmin?: boolean } = {}) {
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

describe('Safety Links API', () => {
    let subjectId = 0, subjectHh = 0, boardId = 0, boardHh = 0;

    async function wipe() {
        const hhs = await prisma.household.findMany({ where: { name: { contains: TAG } }, select: { id: true } });
        const ids = hhs.map((h) => h.id);
        const parts = await prisma.participant.findMany({ where: { householdId: { in: ids } }, select: { id: true } });
        const pids = parts.map((p) => p.id);
        if (pids.length) {
            await prisma.safetyLinkReview.deleteMany({ where: { subjectParticipantId: { in: pids } } });
            await prisma.safetyLink.deleteMany({ where: { subjectParticipantId: { in: pids } } });
        }
        await prisma.participant.deleteMany({ where: { householdId: { in: ids } } });
        await prisma.household.deleteMany({ where: { id: { in: ids } } });
    }

    beforeAll(async () => {
        await wipe();
        const hh = await prisma.household.create({ data: { name: `Subj HH ${TAG}` } });
        subjectHh = hh.id;
        subjectId = (await prisma.participant.create({ data: { name: 'Subj', householdId: hh.id } })).id;
        const bhh = await prisma.household.create({ data: { name: `Board HH ${TAG}` } });
        boardHh = bhh.id;
        boardId = (await prisma.participant.create({ data: { name: 'Board', boardMember: true, householdId: bhh.id } })).id;
    });

    afterAll(async () => {
        await wipe();
        await prisma.$disconnect();
    });

    it('defaults the subject to the caller and returns 201', async () => {
        as(subjectId, subjectHh);
        const res = await CREATE(post('/api/safety-links', { relationshipType: 'FAMILY', counterpartyName: 'Cousin', description: 'My cousin volunteers here.' }));
        expect(res.status).toBe(201);
        const link = await prisma.safetyLink.findFirst({ where: { subjectParticipantId: subjectId }, include: { reviews: true } });
        expect(link?.origin).toBe('SELF_DISCLOSED');
        expect(link?.reviews[0].status).toBe('PENDING_BOARD_REVIEW');
    });

    it('forbids a non-staff member disclosing about a different subject', async () => {
        as(subjectId, subjectHh);
        const res = await CREATE(post('/api/safety-links', { subjectParticipantId: boardId, relationshipType: 'OTHER', counterpartyName: 'X', description: 'x' }));
        expect(res.status).toBe(403);
    });

    it('mine returns the caller links but strips board-internal fields', async () => {
        as(subjectId, subjectHh);
        const res = await MINE(get('/api/safety-links/mine'));
        const body = await res.json();
        expect(Array.isArray(body.safetyLinks)).toBe(true);
        expect(body.safetyLinks.length).toBeGreaterThanOrEqual(1);
        const link = body.safetyLinks[0];
        expect(link.description).toBeDefined(); // their_own:personal granted
        // internal fields are never selected/granted on this route
        expect(link.origin).toBeUndefined();
        expect(link.reviews[0].decisionNote).toBeUndefined();
    });

    it('rejects a decision from a non-board caller and accepts one from the board', async () => {
        const link = await prisma.safetyLink.findFirst({ where: { subjectParticipantId: subjectId }, include: { reviews: true } });
        const reviewId = link!.reviews[0].id;

        as(subjectId, subjectHh); // not board
        expect((await DECISION(post('/api/admin/safety-links/decision', { reviewId, decision: 'APPROVE' }))).status).toBe(403);

        as(boardId, boardHh, { boardMember: true });
        const ok = await DECISION(post('/api/admin/safety-links/decision', { reviewId, decision: 'APPROVE' }));
        expect(ok.status).toBe(200);
        expect((await ok.json()).status).toBe('APPROVED');
    });
});
