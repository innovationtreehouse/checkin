/**
 * @jest-environment node
 */
/**
 * Unit tests for GET /api/membership-ops/volunteer-memberships — the roster's
 * row assembly: how a volunteer OrgMembership and a VolunteerDesignation each
 * map to a status, and how a designation that already became a volunteer
 * household folds into that household's row instead of listing twice. The deny
 * paths (401 anon / 403 plain member) are in authzRoleRejection.integration.test.ts.
 */
import { GET } from '../route';
import prisma from '@/lib/prisma';

jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mockSession = require('next-auth/next').getServerSession;

const req = () => new Request('http://localhost/api/membership-ops/volunteer-memberships');

const lead = (name: string, email?: string) => ({ name, ...(email ? { email } : {}) });

/** A volunteer OrgMembership row as the route selects it. */
const membership = (over: Partial<Record<string, unknown>> = {}) => ({
    status: 'ACTIVE',
    memberSince: new Date('2025-03-04T00:00:00.000Z'),
    processes: [],
    household: { id: 1, name: 'Alvarez', householdMembers: [lead('Ana Alvarez', 'ana@example.com')] },
    ...over,
});

const designation = (id: number, email: string) => ({
    id,
    email,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
});

function mockDb(opts: {
    memberships?: unknown[];
    designations?: unknown[];
    people?: unknown[];
}) {
    prisma.orgMembership.findMany = jest.fn().mockResolvedValue(opts.memberships ?? []);
    prisma.volunteerDesignation.findMany = jest.fn().mockResolvedValue(opts.designations ?? []);
    prisma.person.findMany = jest.fn().mockResolvedValue(opts.people ?? []);
}

const rowsFor = async () => (await (await GET(req())).json()).rows;

beforeEach(() => {
    jest.clearAllMocks();
    mockSession.mockResolvedValue({ user: { id: 5, isBoardMember: true } });
});

it('reports an ACTIVE volunteer household as a volunteer member', async () => {
    mockDb({ memberships: [membership()] });

    expect(await rowsFor()).toEqual([
        {
            key: 'hh:1',
            status: 'VOLUNTEER',
            householdId: 1,
            householdName: 'Alvarez',
            leads: ['Ana Alvarez'],
            email: 'ana@example.com',
            memberSince: '2025-03-04T00:00:00.000Z',
            designationId: null,
            designatedAt: null,
        },
    ]);
});

it('reports a volunteer household with an in-flight process as in progress', async () => {
    mockDb({ memberships: [membership({ status: 'NONE', processes: [{ id: 9 }] })] });

    const [row] = await rowsFor();
    expect(row.status).toBe('IN_PROGRESS');
    // memberSince is meaningless until the membership activates.
    expect(row.memberSince).toBeNull();
});

it('reports a revoked or denied volunteer household as revoked', async () => {
    mockDb({ memberships: [membership({ status: 'REVOKED' }), membership({ status: 'DENIED', household: { id: 2, name: 'Baker', householdMembers: [] } })] });

    expect((await rowsFor()).map((r: { status: string }) => r.status)).toEqual(['REVOKED', 'REVOKED']);
});

it('lists a designated email that has no person yet as pre-designated', async () => {
    mockDb({ designations: [designation(7, 'zoe@example.com')] });

    expect(await rowsFor()).toEqual([
        {
            key: 'des:7',
            status: 'DESIGNATED',
            householdId: null,
            householdName: null,
            leads: [],
            email: 'zoe@example.com',
            memberSince: null,
            designationId: 7,
            designatedAt: '2026-07-01T00:00:00.000Z',
        },
    ]);
});

it('flags a designated email whose household already pays full price', async () => {
    mockDb({
        designations: [designation(8, 'bo@example.com')],
        people: [{
            email: 'bo@example.com',
            household: {
                id: 5,
                name: 'Baker',
                orgMembership: { status: 'ACTIVE', memberSince: new Date('2024-01-02T00:00:00.000Z'), processes: [] },
                householdMembers: [lead('Bo Baker')],
            },
        }],
    });

    const [row] = await rowsFor();
    expect(row).toMatchObject({ status: 'FULL_PRICE', householdName: 'Baker', leads: ['Bo Baker'] });
});

it('folds a designation into the volunteer household it already produced', async () => {
    mockDb({
        memberships: [membership()],
        designations: [designation(7, 'ANA@example.com')],
        people: [{
            email: 'ana@example.com',
            household: {
                id: 1,
                name: 'Alvarez',
                orgMembership: { status: 'ACTIVE', memberSince: new Date('2025-03-04T00:00:00.000Z'), processes: [] },
                householdMembers: [lead('Ana Alvarez')],
            },
        }],
    });

    const rows = await rowsFor();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: 'hh:1', status: 'VOLUNTEER', designationId: 7 });
});

it('skips the person lookup when there are no designations', async () => {
    mockDb({ memberships: [membership()] });
    await rowsFor();

    expect(prisma.person.findMany).not.toHaveBeenCalled();
});
