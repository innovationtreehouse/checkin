/**
 * @jest-environment node
 */
/**
 * Integration tests for board membership settings + volunteer designations.
 */

import { GET as SETTINGS_GET, PUT as SETTINGS_PUT } from '@/app/api/settings/membership/route';
import { GET as DESIG_GET, POST as DESIG_POST, DELETE as DESIG_DELETE } from '@/app/api/settings/membership/volunteer-designations/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));

const TAG = 'settings-test';

function asBoard(id: number) {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { id, isSysadmin: false, isBoardMember: true } });
}
function asUser(id: number) {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { id, isSysadmin: false, isBoardMember: false } });
}
function jsonReq(method: string, body?: unknown, url = 'http://localhost:4000/x') {
    return new Request(url, { method, ...(body ? { body: JSON.stringify(body) } : {}) }) as never;
}

describe('Membership settings + volunteer designations API', () => {
    let boardId: number, plainId: number;
    let prevSettings: { normalDuesCents: number; volunteerDuesCents: number; emailFromAddress: string | null; emailReplyToAddress: string | null } | null = null;

    async function wipe() {
        await prisma.volunteerDesignation.deleteMany({ where: { email: { contains: TAG } } });
        const hhs = await prisma.household.findMany({ where: { name: { contains: TAG } }, select: { id: true } });
        const ids = hhs.map((h) => h.id);
        if (ids.length) {
            await prisma.orgMembership.deleteMany({ where: { householdId: { in: ids } } });
            await prisma.householdLead.deleteMany({ where: { householdId: { in: ids } } });
            await prisma.person.deleteMany({ where: { householdId: { in: ids } } });
            await prisma.household.deleteMany({ where: { id: { in: ids } } });
        }
        await prisma.person.deleteMany({ where: { email: { contains: TAG } } });
    }

    beforeAll(async () => {
        const existing = await prisma.boardSettings.findUnique({ where: { id: 1 } });
        prevSettings = existing ? { normalDuesCents: existing.normalDuesCents, volunteerDuesCents: existing.volunteerDuesCents, emailFromAddress: existing.emailFromAddress, emailReplyToAddress: existing.emailReplyToAddress } : null;
        await wipe();

        boardId = (await prisma.person.create({ data: { email: `board-${TAG}@example.com`, name: 'Board', isBoardMember: true, household: { create: { name: `Board HH ${TAG}` } } } })).id;
        plainId = (await prisma.person.create({ data: { email: `plain-${TAG}@example.com`, name: 'Plain', household: { create: { name: `Plain HH ${TAG}` } } } })).id;

        // A full-price active member, for the designation warning.
        await prisma.person.create({
            data: { email: `fullmember-${TAG}@example.com`, name: 'Full', household: { create: { name: `Full HH ${TAG}`, orgMembership: { create: { status: 'ACTIVE', isVolunteer: false } } } } },
        });
    });

    afterAll(async () => {
        await wipe();
        if (prevSettings) await prisma.boardSettings.update({ where: { id: 1 }, data: prevSettings });
        await prisma.$disconnect();
    });

    it('non-board cannot read settings', async () => {
        asUser(plainId);
        const res = await SETTINGS_GET(jsonReq('GET'));
        expect(res.status).toBe(403);
    });

    it('board can read and update settings', async () => {
        asBoard(boardId);
        const getRes = await SETTINGS_GET(jsonReq('GET'));
        expect(getRes.status).toBe(200);

        const putRes = await SETTINGS_PUT(jsonReq('PUT', { normalDuesCents: 12000, volunteerDuesCents: 3000 }));
        expect(putRes.status).toBe(200);
        const { settings } = await putRes.json();
        expect(settings.normalDuesCents).toBe(12000);
        expect(settings.volunteerDuesCents).toBe(3000);
    });

    it('rejects negative dues and keeps the previous value', async () => {
        asBoard(boardId);
        // Establish a known good value.
        const seed = await SETTINGS_PUT(jsonReq('PUT', { normalDuesCents: 12000 }));
        expect(seed.status).toBe(200);

        // Negative input must be rejected, not clamped to zero.
        const res = await SETTINGS_PUT(jsonReq('PUT', { normalDuesCents: -50 }));
        expect(res.status).toBe(400);

        // Old value survives untouched.
        const getRes = await SETTINGS_GET(jsonReq('GET'));
        const { settings } = await getRes.json();
        expect(settings.normalDuesCents).toBe(12000);
    });

    it('accepts a valid email sender identity and rejects a malformed one (keeping the prior value)', async () => {
        asBoard(boardId);
        // Both header shapes are accepted.
        const ok = await SETTINGS_PUT(jsonReq('PUT', {
            emailFromAddress: 'Treehouse <noreply@updates.example.org>',
            emailReplyToAddress: 'board@example.org',
        }));
        expect(ok.status).toBe(200);
        const saved = (await ok.json()).settings;
        expect(saved.emailFromAddress).toBe('Treehouse <noreply@updates.example.org>');
        expect(saved.emailReplyToAddress).toBe('board@example.org');

        // A malformed From is rejected and must not clobber the saved value.
        const bad = await SETTINGS_PUT(jsonReq('PUT', { emailFromAddress: 'not-an-email' }));
        expect(bad.status).toBe(400);
        const after = (await (await SETTINGS_GET(jsonReq('GET'))).json()).settings;
        expect(after.emailFromAddress).toBe('Treehouse <noreply@updates.example.org>');

        // Empty string clears back to the env default (null).
        const cleared = await SETTINGS_PUT(jsonReq('PUT', { emailFromAddress: '', emailReplyToAddress: '' }));
        expect(cleared.status).toBe(200);
        const clearedSettings = (await cleared.json()).settings;
        expect(clearedSettings.emailFromAddress).toBeNull();
        expect(clearedSettings.emailReplyToAddress).toBeNull();
    });

    it('adds, lists, and removes a volunteer designation', async () => {
        asBoard(boardId);
        const addRes = await DESIG_POST(jsonReq('POST', { email: `vol-${TAG}@example.com` }));
        expect(addRes.status).toBe(201);
        const { designation } = await addRes.json();
        expect(designation.email).toBe(`vol-${TAG}@example.com`);

        const listRes = await DESIG_GET(jsonReq('GET'));
        const { designations } = await listRes.json();
        expect(designations.some((d: { email: string }) => d.email === `vol-${TAG}@example.com`)).toBe(true);

        const delRes = await DESIG_DELETE(jsonReq('DELETE', undefined, `http://localhost:4000/x?id=${designation.id}`));
        expect(delRes.status).toBe(200);
        const after = await prisma.volunteerDesignation.findUnique({ where: { id: designation.id } });
        expect(after).toBeNull();
    });

    it('warns when designating an already-active full-price member', async () => {
        asBoard(boardId);
        const res = await DESIG_POST(jsonReq('POST', { email: `fullmember-${TAG}@example.com` }));
        expect(res.status).toBe(201);
        const data = await res.json();
        expect(data.warning).toBeTruthy();
    });

    it('rejects an invalid email', async () => {
        asBoard(boardId);
        const res = await DESIG_POST(jsonReq('POST', { email: 'not-an-email' }));
        expect(res.status).toBe(400);
    });

    it('non-board cannot manage designations', async () => {
        asUser(plainId);
        const res = await DESIG_POST(jsonReq('POST', { email: `x-${TAG}@example.com` }));
        expect(res.status).toBe(403);
    });
});
