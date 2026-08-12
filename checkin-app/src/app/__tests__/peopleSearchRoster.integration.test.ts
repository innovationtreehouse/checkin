/**
 * @jest-environment node
 */
/**
 * GET /api/people/search?roster=active — the population badge display names are
 * disambiguated against (#1625).
 *
 * The page-level test proves the printed name doesn't move when the operator ticks a
 * checkbox or types, but it does that against a mocked server. These are the server-side
 * halves of the same claim: roster mode returns ACTIVE members only, excludes merge
 * tombstones, and — the part the whole fix rests on — ignores `q` entirely, so a search
 * cannot shrink the population a name is computed from.
 */

import { GET } from '@/app/api/people/search/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));

const TAG = 'roster-1625';

describe('GET /api/people/search?roster=active', () => {
    let adminId: number;

    /** Delete this file's people, their memberships, then the households left empty. */
    async function wipe() {
        const rows = await prisma.person.findMany({
            where: { email: { contains: TAG } },
            select: { householdId: true },
        });
        const householdIds = [...new Set(rows.map(r => r.householdId).filter((id): id is number => id != null))];
        if (householdIds.length) {
            await prisma.orgMembership.deleteMany({ where: { householdId: { in: householdIds } } });
        }
        await prisma.person.deleteMany({ where: { email: { contains: TAG } } });
        if (householdIds.length) {
            await prisma.household.deleteMany({ where: { id: { in: householdIds }, householdMembers: { none: {} } } });
        }
    }

    /** One person in their own household, whose membership sits at `status`. */
    const makePerson = (name: string, slug: string, status: 'ACTIVE' | 'NONE') =>
        prisma.person.create({
            data: {
                name,
                email: `${slug}-${TAG}@example.com`,
                household: { create: { name: `HH ${slug} ${TAG}`, orgMembership: { create: { status } } } },
            },
        });

    beforeAll(async () => {
        await wipe();
        const admin = await makePerson('Admin Roster', 'admin', 'NONE');
        await prisma.person.update({ where: { id: admin.id }, data: { isSysadmin: true } });
        adminId = admin.id;

        await makePerson('John Smith', 'smith', 'ACTIVE');
        await makePerson('John Doe', 'doe', 'ACTIVE');
        await makePerson('John Lapsed', 'lapsed', 'NONE');

        // ACTIVE but merged away: a tombstone row that LIVE_PERSON must keep out.
        const ghost = await makePerson('John Ghost', 'ghost', 'ACTIVE');
        await prisma.person.update({ where: { id: ghost.id }, data: { mergedIntoId: adminId } });

        (getServerSession as jest.Mock).mockResolvedValue({
            user: { id: adminId, isSysadmin: true, isBoardMember: false },
        });
    });

    afterAll(wipe);

    const roster = async (query: string) => {
        const req = new Request(`http://localhost:4000/api/people/search?${query}`);
        const res = await GET(req as unknown as Parameters<typeof GET>[0]);
        expect(res.status).toBe(200);
        const { people } = await res.json();
        return (people as { id: number; name: string }[])
            .filter(p => ['John Smith', 'John Doe', 'John Lapsed', 'John Ghost'].includes(p.name))
            .map(p => p.name)
            .sort();
    };

    it('returns ACTIVE members only, excluding non-members and merge tombstones', async () => {
        expect(await roster('roster=active')).toEqual(['John Doe', 'John Smith']);
    });

    it('ignores `q`, so searching cannot shrink the population a printed name derives from', async () => {
        expect(await roster('roster=active&q=Smith')).toEqual(['John Doe', 'John Smith']);
    });

    it('still searches normally without the roster flag', async () => {
        expect(await roster('q=John Smith')).toEqual(['John Smith']);
    });
});
