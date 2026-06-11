/**
 * @jest-environment node
 */
/**
 * Integration tests for the EXTERNAL phase: the Zoho contract webhook,
 * the board external controls, and the advance-to-PENDING_BG_REVIEW logic.
 */

import { POST as ZOHO_WEBHOOK } from '@/app/api/webhooks/zoho/route';
import { POST as BOARD_EXTERNAL } from '@/app/api/admin/membership/external/route';
import { GET as ADMIN_LIST } from '@/app/api/admin/membership/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
// Advancing to PENDING_BG_REVIEW pings reviewers; don't hit Resend in tests.
jest.mock('@/lib/email', () => ({ sendEmail: jest.fn().mockResolvedValue(true) }));

const TAG = 'membership-external-test';
const SECRET = 'zoho-test-secret';

function asBoard(id: number) {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { id, sysadmin: false, boardMember: true } });
}
function asUser(id: number) {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { id, sysadmin: false, boardMember: false } });
}

function boardReq(body: unknown) {
    return new Request('http://localhost:4000/api/admin/membership/external', {
        method: 'POST',
        body: JSON.stringify(body),
    }) as unknown as Parameters<typeof BOARD_EXTERNAL>[0];
}
function zohoReq(body: unknown, token: string | null) {
    return new Request('http://localhost:4000/api/webhooks/zoho', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { 'x-zoho-webhook-token': token } : {}) },
        body: JSON.stringify(body),
    });
}

describe('Membership EXTERNAL phase API', () => {
    let boardId: number;
    let plainUserId: number;
    let hhA: number;
    let hhB: number;
    let procA: number;
    let procB: number;
    const prevSecret = process.env.ZOHO_WEBHOOK_SECRET;

    async function makeProcess(name: string, envelopeId: string) {
        const hh = await prisma.household.create({ data: { name } });
        const m = await prisma.membership.create({ data: { householdId: hh.id, status: 'NONE' } });
        const p = await prisma.membershipProcess.create({
            data: { membershipId: m.id, kind: 'INITIAL', status: 'PENDING_EXTERNAL_ACTION', zohoEnvelopeId: envelopeId },
        });
        return { householdId: hh.id, processId: p.id };
    }

    async function wipe() {
        const hhs = await prisma.household.findMany({ where: { name: { contains: TAG } }, select: { id: true } });
        const ids = hhs.map((h) => h.id);
        if (ids.length) {
            await prisma.membershipProcess.deleteMany({ where: { membership: { householdId: { in: ids } } } });
            await prisma.membership.deleteMany({ where: { householdId: { in: ids } } });
            await prisma.participant.deleteMany({ where: { householdId: { in: ids } } });
            await prisma.household.deleteMany({ where: { id: { in: ids } } });
        }
        await prisma.participant.deleteMany({ where: { email: { contains: TAG } } });
    }

    beforeAll(async () => {
        process.env.ZOHO_WEBHOOK_SECRET = SECRET;
        await wipe();

        const board = await prisma.participant.create({ data: { email: `board-${TAG}@example.com`, name: 'Board', boardMember: true, household: { create: {} } } });
        boardId = board.id;
        const user = await prisma.participant.create({ data: { email: `user-${TAG}@example.com`, name: 'User', household: { create: {} } } });
        plainUserId = user.id;

        const a = await makeProcess(`A ${TAG}`, 'zoho-A');
        hhA = a.householdId;
        procA = a.processId;
        const b = await makeProcess(`B ${TAG}`, 'zoho-B');
        hhB = b.householdId;
        procB = b.processId;
    });

    afterAll(async () => {
        await wipe();
        // boardId/userId households
        await prisma.participant.deleteMany({ where: { email: { contains: TAG } } });
        if (prevSecret === undefined) delete process.env.ZOHO_WEBHOOK_SECRET;
        else process.env.ZOHO_WEBHOOK_SECRET = prevSecret;
        await prisma.$disconnect();
    });

    it('rejects a non-board user from the external controls', async () => {
        asUser(plainUserId);
        const res = await BOARD_EXTERNAL(boardReq({ processId: procA, action: 'mark-contract' }) as never);
        expect(res.status).toBe(403);
    });

    it('marking the contract alone keeps the process in EXTERNAL', async () => {
        asBoard(boardId);
        const res = await BOARD_EXTERNAL(boardReq({ processId: procA, action: 'mark-contract' }) as never);
        expect(res.status).toBe(200);
        const p = await prisma.membershipProcess.findUnique({ where: { id: procA } });
        expect(p?.contractSignedAt).not.toBeNull();
        expect(p?.status).toBe('PENDING_EXTERNAL_ACTION');
    });

    it('marking BG consent after the contract advances to PENDING_BG_REVIEW', async () => {
        asBoard(boardId);
        const res = await BOARD_EXTERNAL(boardReq({ processId: procA, action: 'mark-bg-consent' }) as never);
        expect(res.status).toBe(200);
        const p = await prisma.membershipProcess.findUnique({ where: { id: procA } });
        expect(p?.bgConsentAt).not.toBeNull();
        expect(p?.status).toBe('PENDING_BG_REVIEW');
    });

    it('rejects a Zoho webhook with a bad token', async () => {
        const res = await ZOHO_WEBHOOK(zohoReq({ requests: { request_id: 'zoho-B', request_status: 'completed' } }, 'wrong'));
        expect(res.status).toBe(401);
    });

    it('a valid completed Zoho webhook records the contract as signed', async () => {
        const res = await ZOHO_WEBHOOK(zohoReq({ requests: { request_id: 'zoho-B', request_status: 'completed' } }, SECRET));
        expect(res.status).toBe(200);
        const p = await prisma.membershipProcess.findUnique({ where: { id: procB } });
        expect(p?.contractSignedAt).not.toBeNull();
        // BG consent not yet given → still EXTERNAL.
        expect(p?.status).toBe('PENDING_EXTERNAL_ACTION');
    });

    it('ignores a non-completed Zoho event without changing state', async () => {
        const res = await ZOHO_WEBHOOK(zohoReq({ requests: { request_id: 'zoho-B', request_status: 'inprogress' } }, SECRET));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.ignored).toBeDefined();
    });

    it('set-envelope associates a Zoho request id', async () => {
        asBoard(boardId);
        const res = await BOARD_EXTERNAL(boardReq({ processId: procB, action: 'set-envelope', envelopeId: 'zoho-B2' }) as never);
        expect(res.status).toBe(200);
        const p = await prisma.membershipProcess.findUnique({ where: { id: procB } });
        expect(p?.zohoEnvelopeId).toBe('zoho-B2');
    });

    it('keeps hhA/hhB distinct (sanity)', () => {
        expect(hhA).not.toBe(hhB);
    });

    it('admin listing rejects a non-board user', async () => {
        asUser(plainUserId);
        const res = await ADMIN_LIST(boardReq({}) as never);
        expect(res.status).toBe(403);
    });

    it('admin listing returns in-flight processes with household + flags for the board', async () => {
        asBoard(boardId);
        const res = await ADMIN_LIST(boardReq({}) as never);
        expect(res.status).toBe(200);
        const data = await res.json();
        const ids = data.processes.map((p: { id: number }) => p.id);
        expect(ids).toEqual(expect.arrayContaining([procA, procB]));
        const a = data.processes.find((p: { id: number }) => p.id === procA);
        expect(a.membership.householdId).toBe(hhA);
        expect(a.status).toBe('PENDING_BG_REVIEW');
    });
});
