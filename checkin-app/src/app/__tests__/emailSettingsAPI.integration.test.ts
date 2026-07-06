/**
 * @jest-environment node
 */
/**
 * Integration tests for the email sender-identity settings API.
 */

import { GET as EMAIL_GET, PUT as EMAIL_PUT } from '@/app/api/settings/email/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));

function asBoard(id: number) {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { id, isSysadmin: false, isBoardMember: true } });
}
function asUser(id: number) {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { id, isSysadmin: false, isBoardMember: false } });
}
function jsonReq(method: string, body?: unknown) {
    return new Request('http://localhost:4000/x', { method, ...(body ? { body: JSON.stringify(body) } : {}) }) as never;
}

const TAG = 'email-settings-test';

describe('Email sender-identity settings API', () => {
    let boardId: number, plainId: number;
    let prevSettings: { emailFromAddress: string | null; emailReplyToAddress: string | null } | null = null;

    async function wipe() {
        const hhs = await prisma.household.findMany({ where: { name: { contains: TAG } }, select: { id: true } });
        const ids = hhs.map((h) => h.id);
        if (ids.length) {
            await prisma.person.deleteMany({ where: { householdId: { in: ids } } });
            await prisma.household.deleteMany({ where: { id: { in: ids } } });
        }
    }

    beforeAll(async () => {
        await wipe();
        boardId = (await prisma.person.create({ data: { name: 'Board', isBoardMember: true, household: { create: { name: `Board HH ${TAG}` } } } })).id;
        plainId = (await prisma.person.create({ data: { name: 'Plain', household: { create: { name: `Plain HH ${TAG}` } } } })).id;
        const existing = await prisma.boardSettings.findUnique({ where: { id: 1 } });
        prevSettings = existing ? { emailFromAddress: existing.emailFromAddress, emailReplyToAddress: existing.emailReplyToAddress } : null;
    });

    afterAll(async () => {
        if (prevSettings) await prisma.boardSettings.update({ where: { id: 1 }, data: prevSettings });
        await wipe();
        await prisma.$disconnect();
    });

    it('non-board cannot read', async () => {
        asUser(plainId);
        expect((await EMAIL_GET(jsonReq('GET'))).status).toBe(403);
    });

    it('board reads, sets a valid identity (both header shapes), and reads it back', async () => {
        asBoard(boardId);
        expect((await EMAIL_GET(jsonReq('GET'))).status).toBe(200);

        const put = await EMAIL_PUT(jsonReq('PUT', {
            emailFromAddress: 'Treehouse <noreply@updates.example.org>',
            emailReplyToAddress: 'board@example.org',
        }));
        expect(put.status).toBe(200);
        const saved = (await put.json()).settings;
        expect(saved.emailFromAddress).toBe('Treehouse <noreply@updates.example.org>');
        expect(saved.emailReplyToAddress).toBe('board@example.org');
    });

    it('rejects a malformed From and keeps the previous value', async () => {
        asBoard(boardId);
        await EMAIL_PUT(jsonReq('PUT', { emailFromAddress: 'Good <ok@example.org>' }));
        const bad = await EMAIL_PUT(jsonReq('PUT', { emailFromAddress: 'not-an-email' }));
        expect(bad.status).toBe(400);
        const after = (await (await EMAIL_GET(jsonReq('GET'))).json()).settings;
        expect(after.emailFromAddress).toBe('Good <ok@example.org>');
    });

    it('accepts a comma-separated Reply-To list', async () => {
        asBoard(boardId);
        const put = await EMAIL_PUT(jsonReq('PUT', { emailReplyToAddress: 'info@example.org, ops@example.org' }));
        expect(put.status).toBe(200);
        const saved = (await put.json()).settings;
        expect(saved.emailReplyToAddress).toBe('info@example.org, ops@example.org');
    });

    it('rejects a Reply-To list with one malformed entry and keeps the previous value', async () => {
        asBoard(boardId);
        await EMAIL_PUT(jsonReq('PUT', { emailReplyToAddress: 'info@example.org, ops@example.org' }));
        const bad = await EMAIL_PUT(jsonReq('PUT', { emailReplyToAddress: 'info@example.org, not-an-email' }));
        expect(bad.status).toBe(400);
        const after = (await (await EMAIL_GET(jsonReq('GET'))).json()).settings;
        expect(after.emailReplyToAddress).toBe('info@example.org, ops@example.org');
    });

    it('empty strings clear back to null (env default From, no Reply-To)', async () => {
        asBoard(boardId);
        const cleared = await EMAIL_PUT(jsonReq('PUT', { emailFromAddress: '', emailReplyToAddress: '' }));
        expect(cleared.status).toBe(200);
        const s = (await cleared.json()).settings;
        expect(s.emailFromAddress).toBeNull();
        expect(s.emailReplyToAddress).toBeNull();
    });
});
