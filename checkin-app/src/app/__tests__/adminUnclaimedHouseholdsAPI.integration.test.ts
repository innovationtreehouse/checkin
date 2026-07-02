/**
 * @jest-environment node
 */
/**
 * Integration Tests for Admin Unclaimed Households API
 * Tests GET /api/membership-audit/unclaimed-households for identifying households
 * where no household lead has signed in with Google yet (registered but never
 * claimed). A household drops off the list as soon as ANY lead claims, even if
 * non-lead members (e.g. students) never sign in.
 */

import { GET } from '@/app/api/membership-audit/unclaimed-households/route';
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

    const cleanup = async () => {
        await prisma.membership.deleteMany({});
        await prisma.householdLead.deleteMany({
            where: { household: { name: { contains: 'Unclaimed API Test' } } }
        });
        await prisma.person.deleteMany({
            where: { email: { contains: 'unclaimed-api-test' } }
        });
        await prisma.household.deleteMany({
            where: { name: { contains: 'Unclaimed API Test' } }
        });
    };

    beforeAll(async () => {
        await cleanup();

        const admin = await prisma.person.create({
            data: { email: 'admin-unclaimed-api-test@example.com', name: 'Admin Unclaimed Test', isSysadmin: true, household: { create: {} } }
        });
        testAdminId = admin.id;

        const user = await prisma.person.create({
            data: { email: 'user-unclaimed-api-test@example.com', name: 'User Unclaimed Test', isSysadmin: false, household: { create: {} } }
        });
        testUserId = user.id;

        // 1. Lead has an email but NO googleId -> unclaimed
        const unclaimed = await prisma.household.create({ data: { name: 'Unclaimed API Test HH Unclaimed' } });
        testUnclaimedHouseholdId = unclaimed.id;
        const unclaimedLead = await prisma.person.create({
            data: { email: 'member1-unclaimed-api-test@example.com', name: 'Unclaimed Lead', householdId: testUnclaimedHouseholdId, googleId: null }
        });
        await prisma.householdLead.create({
            data: { householdId: testUnclaimedHouseholdId, personId: unclaimedLead.id }
        });

        // 2. Lead HAS a googleId -> claimed, even though a student member never signs in.
        // This is the case that must NOT appear: a claimed lead covers the household.
        const claimed = await prisma.household.create({ data: { name: 'Unclaimed API Test HH Claimed' } });
        testClaimedHouseholdId = claimed.id;
        const claimedLead = await prisma.person.create({
            data: { email: 'member2-unclaimed-api-test@example.com', name: 'Claimed Lead', householdId: testClaimedHouseholdId, googleId: 'unclaimed-test-google-id' }
        });
        await prisma.householdLead.create({
            data: { householdId: testClaimedHouseholdId, personId: claimedLead.id }
        });
        // Student in the claimed household with an email but no googleId (never signs in).
        await prisma.person.create({
            data: { email: 'student-unclaimed-api-test@example.com', name: 'Student', householdId: testClaimedHouseholdId, googleId: null }
        });
    });

    afterAll(cleanup);

    describe('GET /api/membership-audit/unclaimed-households', () => {
        it('should return 403 Forbidden without admin', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testUserId, isSysadmin: false, isBoardMember: false }
            });

            const req = new Request('http://localhost:4000/api/membership-audit/unclaimed-households', { method: 'GET' });
            const res = await GET(req as unknown as import("next/server").NextRequest);
            expect(res.status).toBe(403);
        });

        it('lists households whose lead never signed in, and drops ones with a claimed lead even if a student never signs in', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, isSysadmin: true }
            });

            const req = new Request('http://localhost:4000/api/membership-audit/unclaimed-households', { method: 'GET' });
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
