/**
 * @jest-environment node
 */
/**
 * Integration tests for the Broken Households tab.
 *  - GET /api/admin/broken-households lists households with zero leads (incl. empty
 *    ones) and excludes households that already have a lead.
 *  - POST /api/household/lead lets a BOARD MEMBER assign a lead to a household they
 *    are not a member of, which un-breaks it.
 */

import { GET } from '@/app/api/admin/broken-households/route';
import { POST } from '@/app/api/household/lead/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn(),
}));

describe('Broken Households API Integration Tests', () => {
    let boardId: number;
    let brokenHouseholdId: number;
    let emptyHouseholdId: number;
    let ledHouseholdId: number;
    let brokenAdultId: number;

    const cleanup = async () => {
        await prisma.householdLead.deleteMany({
            where: { household: { name: { contains: 'Broken API Test' } } }
        });
        await prisma.participant.deleteMany({
            where: { email: { contains: 'broken-api-test' } }
        });
        await prisma.household.deleteMany({
            where: { name: { contains: 'Broken API Test' } }
        });
    };

    beforeAll(async () => {
        await cleanup();

        // Acting board member (not a member of any test household below).
        const board = await prisma.participant.create({
            data: { email: 'board-broken-api-test@example.com', name: 'Board Broken Test', boardMember: true, household: { create: {} } }
        });
        boardId = board.id;

        // 1. Leadless household with an adult + a minor -> broken.
        const broken = await prisma.household.create({ data: { name: 'Broken API Test HH Broken' } });
        brokenHouseholdId = broken.id;
        const adult = await prisma.participant.create({
            data: { email: 'adult-broken-api-test@example.com', name: 'Broken Adult', householdId: brokenHouseholdId, dateOfBirth: new Date('1990-01-01') }
        });
        brokenAdultId = adult.id;
        await prisma.participant.create({
            data: { email: 'minor-broken-api-test@example.com', name: 'Broken Minor', householdId: brokenHouseholdId, dateOfBirth: new Date('2015-01-01') }
        });

        // 2. Leadless household with no participants -> still broken (included).
        const empty = await prisma.household.create({ data: { name: 'Broken API Test HH Empty' } });
        emptyHouseholdId = empty.id;

        // 3. Household that already has a lead -> NOT broken.
        const led = await prisma.household.create({ data: { name: 'Broken API Test HH Led' } });
        ledHouseholdId = led.id;
        const leadMember = await prisma.participant.create({
            data: { email: 'lead-broken-api-test@example.com', name: 'Existing Lead', householdId: ledHouseholdId, dateOfBirth: new Date('1985-01-01') }
        });
        await prisma.householdLead.create({
            data: { householdId: ledHouseholdId, participantId: leadMember.id }
        });
    });

    afterAll(cleanup);

    it('GET lists leadless households (including empty) and excludes led ones', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({
            user: { id: boardId, sysadmin: false, boardMember: true }
        });

        const req = new Request('http://localhost:4000/api/admin/broken-households', { method: 'GET' });
        const res = await GET(req as unknown as import('next/server').NextRequest);
        expect(res.status).toBe(200);

        const data = await res.json();
        const ids = data.households.map((h: { id: number }) => h.id);
        expect(ids).toContain(brokenHouseholdId);
        expect(ids).toContain(emptyHouseholdId);
        expect(ids).not.toContain(ledHouseholdId);

        const broken = data.households.find((h: { id: number }) => h.id === brokenHouseholdId);
        expect(broken.members).toHaveLength(2);
    });

    it('POST lets a board member assign a lead to a household they are not in, un-breaking it', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({
            user: { id: boardId, sysadmin: false, boardMember: true }
        });

        const req = new Request('http://localhost:4000/api/household/lead', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ participantId: brokenAdultId }),
        });
        const res = await POST(req as unknown as import('next/server').NextRequest);
        expect(res.status).toBe(200);

        const lead = await prisma.householdLead.findUnique({
            where: { householdId_participantId: { householdId: brokenHouseholdId, participantId: brokenAdultId } }
        });
        expect(lead).not.toBeNull();

        // No longer broken.
        const getRes = await GET(
            new Request('http://localhost:4000/api/admin/broken-households', { method: 'GET' }) as unknown as import('next/server').NextRequest
        );
        const ids = (await getRes.json()).households.map((h: { id: number }) => h.id);
        expect(ids).not.toContain(brokenHouseholdId);
    });
});
