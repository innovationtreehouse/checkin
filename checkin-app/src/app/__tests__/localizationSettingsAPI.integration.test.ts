/**
 * @jest-environment node
 */
/**
 * Integration tests for localization settings (PUT /api/admin/settings/localization):
 * persistence + audit logging. Deny-path authz is covered by the authz drift guard;
 * here we keep auth assertions minimal and focus on audit + persistence.
 */

import { PUT } from '@/app/api/admin/settings/localization/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));

function asAdmin(id: number) {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { id, sysadmin: true } });
}
function asUser(id: number) {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { id, sysadmin: false } });
}
function jsonReq(body?: unknown) {
    return new Request('http://localhost:4000/api/admin/settings/localization', {
        method: 'PUT',
        ...(body ? { body: JSON.stringify(body) } : {}),
    }) as never;
}

describe('Localization settings API', () => {
    let adminId: number, plainId: number;
    let prevSettings: { timezone: string; locale: string } | null = null;

    beforeAll(async () => {
        const existing = await prisma.appSettings.findUnique({ where: { id: 1 } });
        prevSettings = existing ? { timezone: existing.timezone, locale: existing.locale } : null;

        adminId = (await prisma.participant.create({
            data: { email: 'admin-loc-test@example.com', name: 'Loc Admin', sysadmin: true, household: { create: {} } },
        })).id;
        plainId = (await prisma.participant.create({
            data: { email: 'plain-loc-test@example.com', name: 'Loc Plain', household: { create: {} } },
        })).id;
    });

    afterAll(async () => {
        await prisma.auditLog.deleteMany({ where: { actorId: { in: [adminId, plainId] } } });
        const hhIds = (await prisma.participant.findMany({
            where: { id: { in: [adminId, plainId] } }, select: { householdId: true },
        })).map((p) => p.householdId);
        await prisma.participant.deleteMany({ where: { id: { in: [adminId, plainId] } } });
        await prisma.household.deleteMany({ where: { id: { in: hhIds } } });
        // Restore the singleton so other suites see the original values.
        if (prevSettings) await prisma.appSettings.update({ where: { id: 1 }, data: prevSettings });
        await prisma.$disconnect();
    });

    it('rejects anon (401) and non-admin (403)', async () => {
        (getServerSession as jest.Mock).mockResolvedValue(null);
        expect((await PUT(jsonReq({ timezone: 'America/New_York' }))).status).toBe(401);

        asUser(plainId);
        expect((await PUT(jsonReq({ timezone: 'America/New_York' }))).status).toBe(403);
    });

    it('persists the update and writes one audit row', async () => {
        asAdmin(adminId);
        const res = await PUT(jsonReq({ timezone: 'America/New_York', locale: 'es-ES' }));
        expect(res.status).toBe(200);
        const { settings } = await res.json();
        expect(settings.timezone).toBe('America/New_York');
        expect(settings.locale).toBe('es-ES');

        // Persisted to the singleton.
        const row = await prisma.appSettings.findUnique({ where: { id: 1 } });
        expect(row?.timezone).toBe('America/New_York');
        expect(row?.locale).toBe('es-ES');

        // Exactly one audit row, with actor/action and the new values in newData.
        const logs = await prisma.auditLog.findMany({ where: { actorId: adminId, tableName: 'AppSettings' } });
        expect(logs.length).toBe(1);
        expect(logs[0].action).toBe('EDIT');
        expect(logs[0].affectedEntityId).toBe(1);
        // Route records the after-image in newData (it does not capture oldData).
        expect(JSON.parse(logs[0].newData as string)).toEqual({ timezone: 'America/New_York', locale: 'es-ES' });
        expect(logs[0].oldData).toBeNull();
    });
});
