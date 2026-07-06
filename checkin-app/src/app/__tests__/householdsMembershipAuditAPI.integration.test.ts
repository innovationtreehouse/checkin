/**
 * @jest-environment node
 */
/**
 * Integration tests for audit logging on the board grant/revoke membership
 * actions in POST /api/membership-ops/households — granting (ACTIVE) and revoking
 * (REVOKED) must each write an AuditLog row recording who acted and what changed.
 */

import { POST } from '@/app/api/membership-ops/households/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn(),
}));

const TAG = 'membership-audit-test';

function post(body: unknown) {
    return POST(new Request('http://localhost:4000/api/membership-ops/households', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    }) as unknown as import('next/server').NextRequest);
}

describe('POST /api/membership-ops/households — grant/revoke audit logging', () => {
    let boardId: number;
    let boardHouseholdId: number;
    let inactiveHouseholdId: number;
    let activeHouseholdId: number;

    beforeAll(async () => {
        const leaked = await prisma.person.findMany({
            where: { email: { contains: TAG } }, select: { id: true },
        });
        await prisma.auditLog.deleteMany({ where: { actorId: { in: leaked.map(u => u.id) } } });
        await prisma.person.deleteMany({ where: { email: { contains: TAG } } });

        // Acting board member (in their own household).
        const board = await prisma.person.create({
            data: { email: `board-${TAG}@example.com`, name: 'Board Actor', isBoardMember: true, household: { create: { name: "Test HH" } } },
        });
        boardId = board.id;
        boardHouseholdId = board.householdId;

        // A household with no membership row → will be granted (ACTIVE).
        const inactive = await prisma.person.create({
            data: { email: `inactive-${TAG}@example.com`, name: 'Inactive Member', household: { create: { name: "Test HH" } } },
        });
        inactiveHouseholdId = inactive.householdId;

        // A household that is already ACTIVE → will be revoked (REVOKED).
        const active = await prisma.person.create({
            data: { email: `active-${TAG}@example.com`, name: 'Active Member', household: { create: { name: "Test HH" } } },
        });
        activeHouseholdId = active.householdId;
        await prisma.orgMembership.create({ data: { householdId: activeHouseholdId, status: 'ACTIVE' } });
    });

    afterAll(async () => {
        const ids = await prisma.person.findMany({
            where: { email: { contains: TAG } }, select: { id: true, householdId: true },
        });
        await prisma.auditLog.deleteMany({ where: { actorId: { in: ids.map(u => u.id) } } });
        await prisma.orgMembership.deleteMany({ where: { householdId: { in: ids.map(u => u.householdId) } } });
        await prisma.person.deleteMany({ where: { email: { contains: TAG } } });
        await prisma.household.deleteMany({ where: { id: { in: ids.map(u => u.householdId) } } });
    });

    it('grants an inactive household, sets ACTIVE, and writes an audit row', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({ user: { id: boardId, isBoardMember: true } });

        const res = await post({ householdId: inactiveHouseholdId, active: true });
        expect(res.status).toBe(200);

        const membership = await prisma.orgMembership.findUnique({ where: { householdId: inactiveHouseholdId } });
        expect(membership?.status).toBe('ACTIVE');

        const audit = await prisma.auditLog.findFirst({
            where: { actorId: boardId, tableName: 'OrgMembership', affectedEntityId: membership!.id },
            orderBy: { id: 'desc' },
        });
        expect(audit).not.toBeNull();
        expect(audit!.actorId).toBe(boardId);
        expect((audit!.newData as { status: string }).status).toBe('ACTIVE');
    });

    it("refuses to grant the actor's OWN household (conflict of interest); sysadmin overrides", async () => {
        (getServerSession as jest.Mock).mockResolvedValue({ user: { id: boardId, isBoardMember: true } });
        const res = await post({ householdId: boardHouseholdId, active: true });
        expect(res.status).toBe(403);
        const before = await prisma.orgMembership.findUnique({ where: { householdId: boardHouseholdId } });
        expect(before?.status ?? 'NONE').not.toBe('ACTIVE'); // not granted

        // Sysadmin is the deliberate remedy.
        (getServerSession as jest.Mock).mockResolvedValue({ user: { id: boardId, isSysadmin: true } });
        const ok = await post({ householdId: boardHouseholdId, active: true });
        expect(ok.status).toBe(200);
        const after = await prisma.orgMembership.findUnique({ where: { householdId: boardHouseholdId } });
        expect(after?.status).toBe('ACTIVE');
    });

    it('revokes an active household, sets REVOKED, and writes an audit row', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({ user: { id: boardId, isBoardMember: true } });

        const res = await post({ householdId: activeHouseholdId, active: false });
        expect(res.status).toBe(200);

        const membership = await prisma.orgMembership.findUnique({ where: { householdId: activeHouseholdId } });
        expect(membership?.status).toBe('REVOKED');

        const audit = await prisma.auditLog.findFirst({
            where: { actorId: boardId, tableName: 'OrgMembership', affectedEntityId: membership!.id },
            orderBy: { id: 'desc' },
        });
        expect(audit).not.toBeNull();
        expect(audit!.actorId).toBe(boardId);
        expect((audit!.oldData as { status: string }).status).toBe('ACTIVE');
        expect((audit!.newData as { status: string }).status).toBe('REVOKED');
    });
});
