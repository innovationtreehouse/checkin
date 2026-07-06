/**
 * @jest-environment node
 */
/**
 * Integration Tests for Admin Badges API
 * Tests GET /api/facility/badges for fetching raw badge scan events
 */

import { GET } from '@/app/api/facility/badges/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

// Mock NextAuth
jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn(),
}));

describe('Admin Badges API Integration Tests', () => {
    let testAdminId: number;
    let testUserId: number;
    let testBadgeEventId: number;

    beforeAll(async () => {
        // Clean up any leaked state
        await prisma.rawBadgeLog.deleteMany({
            where: {
                person: { email: { contains: 'badges-api-test' } }
            }
        });
        await prisma.person.deleteMany({
            where: { email: { contains: 'badges-api-test' } }
        });

        // Setup mock database records
        const admin = await prisma.person.create({
            data: { email: 'admin-badges-api-test@example.com', name: 'Admin Badges Test', isSysadmin: true, household: { create: { name: "Test HH" } } }
        });
        testAdminId = admin.id;

        const user = await prisma.person.create({
            data: { email: 'user-badges-api-test@example.com', name: 'User Badges Test', household: { create: { name: "Test HH" } } }
        });
        testUserId = user.id;

        const badgeEvent = await prisma.rawBadgeLog.create({
            data: {
                personId: testUserId,
                location: 'Front Door'
            }
        });
        testBadgeEventId = badgeEvent.id;
    });

    afterAll(async () => {
        // Clean up
        await prisma.rawBadgeLog.deleteMany({
            where: { id: testBadgeEventId }
        });
        await prisma.person.deleteMany({
            where: { id: { in: [testAdminId, testUserId] } }
        });
    });

    describe('GET /api/facility/badges', () => {
        it('should return 401 Unauthorized without session', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);

             const req = new Request('http://localhost:4000/api/facility/badges', {
                 method: 'GET'
             });

             const res = await GET(req as unknown as import("next/server").NextRequest);
             expect(res.status).toBe(401);
        });

        it('should return 403 Forbidden for non-admin users', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({
                 user: { id: testUserId, isSysadmin: false, isBoardMember: false }
             });

             const req = new Request('http://localhost:4000/api/facility/badges', {
                 method: 'GET'
             });

             const res = await GET(req as unknown as import("next/server").NextRequest);
             expect(res.status).toBe(403);
        });

        it('should successfully return recent raw badge events for admins', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, isSysadmin: true, isBoardMember: false }
            });

            const req = new Request('http://localhost:4000/api/facility/badges', {
                method: 'GET'
            });

            const res = await GET(req as unknown as import("next/server").NextRequest);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.badges).toBeDefined();
            expect(Array.isArray(data.badges)).toBe(true);
            
            // Verify our test event is in the response with participant joined
            const foundEvent = data.badges.find((b: { id?: number; email?: string; name?: string; participantId?: number; level?: string; status?: string; role?: string; type?: string; [key: string]: unknown }) => b.id === testBadgeEventId);
            expect(foundEvent).toBeDefined();
            expect(foundEvent.location).toBe('Front Door');
            expect(foundEvent.person).toBeDefined();
            expect(foundEvent.person.name).toBe('User Badges Test');
            expect(foundEvent.person.email).toBe('user-badges-api-test@example.com');
        });
    });
});
