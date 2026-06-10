/**
 * @jest-environment node
 */
/**
 * Integration tests for GET /api/notifications — role-relevant in-app counts,
 * namespaced by domain (membership today).
 */

import { GET as NOTIFS } from '@/app/api/notifications/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));

const TAG = 'notif-test';

function as(id: number, roles: { backgroundCheckReviewer?: boolean; boardMember?: boolean; sysadmin?: boolean } = {}) {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { id, sysadmin: false, boardMember: false, backgroundCheckReviewer: false, ...roles } });
}
const req = () => new Request('http://localhost:4000/x') as never;

describe('Membership notifications API', () => {
    let reviewerId: number, boardId: number, plainId: number;

    async function wipe() {
        const hhs = await prisma.household.findMany({ where: { OR: [{ name: { contains: TAG } }, { participants: { some: { email: { contains: TAG } } } }] }, select: { id: true } });
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
        await wipe();
        reviewerId = (await prisma.participant.create({ data: { email: `rev-${TAG}@example.com`, name: 'Rev', backgroundCheckReviewer: true, household: { create: { name: `Rev HH ${TAG}` } } } })).id;
        boardId = (await prisma.participant.create({ data: { email: `board-${TAG}@example.com`, name: 'Board', boardMember: true, household: { create: { name: `Board HH ${TAG}` } } } })).id;
        plainId = (await prisma.participant.create({ data: { email: `plain-${TAG}@example.com`, name: 'Plain', household: { create: { name: `Plain HH ${TAG}` } } } })).id;

        // An application awaiting review (eligible for the reviewer — different household).
        const appHh = await prisma.household.create({ data: { name: `App HH ${TAG}` } });
        const m1 = await prisma.membership.create({ data: { householdId: appHh.id, status: 'NONE' } });
        await prisma.membershipProcess.create({ data: { membershipId: m1.id, kind: 'INITIAL', status: 'PENDING_BG_REVIEW' } });

        // A blocked application (for the board).
        const blkHh = await prisma.household.create({ data: { name: `Blk HH ${TAG}` } });
        const m2 = await prisma.membership.create({ data: { householdId: blkHh.id, status: 'NONE' } });
        await prisma.membershipProcess.create({ data: { membershipId: m2.id, kind: 'INITIAL', status: 'BLOCKED' } });
    });

    afterAll(async () => {
        await wipe();
        await prisma.$disconnect();
    });

    it('a reviewer sees their pending review count', async () => {
        as(reviewerId, { backgroundCheckReviewer: true });
        const data = await (await NOTIFS(req())).json();
        expect(data.membership.pendingReviews).toBeGreaterThanOrEqual(1);
        expect(data.membership.blocked).toBe(0); // not board
    });

    it('a board member sees the blocked count', async () => {
        as(boardId, { boardMember: true });
        const data = await (await NOTIFS(req())).json();
        expect(data.membership.blocked).toBeGreaterThanOrEqual(1);
        expect(data.membership.pendingReviews).toBe(0); // not a reviewer
    });

    it('a plain user sees nothing', async () => {
        as(plainId);
        const data = await (await NOTIFS(req())).json();
        expect(data).toEqual({ membership: { pendingReviews: 0, blocked: 0 } });
    });
});
