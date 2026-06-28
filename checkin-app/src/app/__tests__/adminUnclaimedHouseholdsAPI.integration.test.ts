/**
 * @jest-environment node
 */
/**
 * Integration Tests for Admin Unclaimed Households API
 * Tests GET /api/admin/unclaimed-households for identifying households with an
 * email-but-no-googleId member (registered but never claimed via Google).
 */

import { GET } from '@/app/api/admin/unclaimed-households/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

// Mock NextAuth
jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn(),
}));

describe('Admin Unclaimed Households API Integration Tests', () => {
    let testAdminId: number;
    let testUserId: number;
    let testUnclaimedHouseholdId: number;
    let testClaimedHouseholdId: number;

    beforeAll(async () => {
        await prisma.membership.deleteMany({});
        await prisma.participant.deleteMany({
            where: { email: { contains: 'unclaimed-api-test' } }
        });
        await prisma.household.deleteMany({
            where: { name: { contains: 'Unclaimed API Test' } }
        });

        const admin = await prisma.participant.create({
            data: { email: 'admin-unclaimed-api-test@example.com', name: 'Admin Unclaimed Test', sysadmin: true, household: { create: {} } }
        });
        testAdminId = admin.id;

        const user = await prisma.participant.create({
            data: { email: 'user-unclaimed-api-test@example.com', name: 'User Unclaimed Test', sysadmin: false, household: { create: {} } }
        });
        testUserId = user.id;

        // 1. Household with a member that has an email but NO googleId -> unclaimed
        const unclaimed = await prisma.household.create({ data: { name: 'Unclaimed API Test HH Unclaimed' } });
        testUnclaimedHouseholdId = unclaimed.id;
        await prisma.participant.create({
            data: { email: 'member1-unclaimed-api-test@example.com', name: 'Unclaimed Member', householdId: testUnclaimedHouseholdId, googleId: null }
        });

        // 2. Household where every member with an email HAS a googleId -> not unclaimed
        const claimed = await prisma.household.create({ data: { name: 'Unclaimed API Test HH Claimed' } });
        testClaimedHouseholdId = claimed.id;
        await prisma.participant.create({
            data: { email: 'member2-unclaimed-api-test@example.com', name: 'Claimed Member', householdId: testClaimedHouseholdId, googleId: 'unclaimed-test-google-id' }
        });
    });

    afterAll(async () => {
        await prisma.membership.deleteMany({});
        await prisma.participant.deleteMany({
            where: { email: { contains: 'unclaimed-api-test' } }
        });
        await prisma.household.deleteMany({
            where: { id: { in: [testUnclaimedHouseholdId, testClaimedHouseholdId] } }
        });
    });

    describe('GET /api/admin/unclaimed-households', () => {
        it('should return 403 Forbidden without admin', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testUserId, sysadmin: false, boardMember: false }
            });

            const req = new Request('http://localhost:4000/api/admin/unclaimed-households', { method: 'GET' });
            const res = await GET(req as unknown as import("next/server").NextRequest);
            expect(res.status).toBe(403);
        });

        it('should list households with an unclaimed member but not fully-claimed ones', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, sysadmin: true }
            });

            const req = new Request('http://localhost:4000/api/admin/unclaimed-households', { method: 'GET' });
            const res = await GET(req as unknown as import("next/server").NextRequest);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(Array.isArray(data.households)).toBe(true);

            const ids = data.households.map((h: { id: number }) => h.id);
            expect(ids).toContain(testUnclaimedHouseholdId);
            expect(ids).not.toContain(testClaimedHouseholdId);

            // Unclaimed household exposes the unclaimed member
            const hh = data.households.find((h: { id: number }) => h.id === testUnclaimedHouseholdId);
            expect(hh.members.some((m: { email: string }) => m.email === 'member1-unclaimed-api-test@example.com')).toBe(true);
        });
    });
});
