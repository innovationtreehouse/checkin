/**
 * @jest-environment node
 */
/**
 * Integration tests for the go-live "open renewals for all active members" action.
 */

import { POST as BULK } from '@/app/api/settings/membership/bulk-open-renewals/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { sendEmail } from '@/lib/email';

jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/email', () => ({ runPaced: (tasks: Array<() => Promise<unknown>>) => Promise.all(tasks.map((t) => t())), sendEmail: jest.fn().mockResolvedValue(true) }));

const TAG = 'bulk-renewal-test';

function asSysadmin(id: number) {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { id, isSysadmin: true, isBoardMember: false } });
}
function asBoard(id: number) {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { id, isSysadmin: false, isBoardMember: true } });
}
function asPlain(id: number) {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { id, isSysadmin: false, isBoardMember: false } });
}
function jsonReq(body?: unknown) {
    return new Request('http://localhost:4000/x', { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) }) as never;
}

describe('Bulk renewal migration', () => {
    let sysId: number, boardId: number, plainId: number;
    let mA: number, mB: number;
    let preMaxProcessId = 0;

    async function makeActive(label: string) {
        const hh = await prisma.household.create({ data: { name: `${label} ${TAG}` } });
        const m = await prisma.orgMembership.create({ data: { householdId: hh.id, status: 'ACTIVE' } });
        return m.id;
    }

    async function wipe() {
        const hhs = await prisma.household.findMany({ where: { OR: [{ name: { contains: TAG } }, { householdMembers: { some: { email: { contains: TAG } } } }] }, select: { id: true } });
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
        const maxRow = await prisma.orgMembershipProcess.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
        preMaxProcessId = maxRow?.id ?? 0;
        await wipe();
        sysId = (await prisma.person.create({ data: { email: `sys-${TAG}@example.com`, name: 'Sys', isSysadmin: true, household: { create: { name: `Sys HH ${TAG}` } } } })).id;
        boardId = (await prisma.person.create({ data: { email: `board-${TAG}@example.com`, name: 'Board', isBoardMember: true, household: { create: { name: `Board HH ${TAG}` } } } })).id;
        plainId = (await prisma.person.create({ data: { email: `plain-${TAG}@example.com`, name: 'Plain', household: { create: { name: `Plain HH ${TAG}` } } } })).id;
        mA = await makeActive('A');
        mB = await makeActive('B');
    });

    afterAll(async () => {
        await prisma.orgMembershipProcess.deleteMany({ where: { id: { gt: preMaxProcessId } } });
        await wipe();
        await prisma.$disconnect();
    });

    it('an unprivileged user is forbidden', async () => {
        asPlain(plainId);
        const res = await BULK(jsonReq({}));
        expect(res.status).toBe(403);
    });

    it('a board member opens PENDING_RENEWAL for all active members, idempotently, never emailing (PR-2)', async () => {
        (sendEmail as jest.Mock).mockClear();
        asBoard(boardId);

        const res = await BULK(jsonReq());
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
        expect(data.opened).toBeGreaterThanOrEqual(2);

        const a = await prisma.orgMembershipProcess.findFirst({ where: { orgMembershipId: mA } });
        const b = await prisma.orgMembershipProcess.findFirst({ where: { orgMembershipId: mB } });
        expect(a?.status).toBe('PENDING_RENEWAL');
        expect(b?.status).toBe('PENDING_RENEWAL');
        expect(sendEmail as jest.Mock).not.toHaveBeenCalled();

        // Idempotent: a second press opens nothing new.
        const second = await BULK(jsonReq());
        expect((await second.json()).opened).toBe(0);
        const count = await prisma.orgMembershipProcess.count({ where: { orgMembershipId: mA } });
        expect(count).toBe(1);
    });

    it('a isSysadmin may also trigger it', async () => {
        asSysadmin(sysId);
        const res = await BULK(jsonReq());
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
        expect(typeof data.opened).toBe('number');
        expect(typeof data.skipped).toBe('number');
    });
});
