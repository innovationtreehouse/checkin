/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @jest-environment node
 */
/**
 * Integration Tests for Admin Badges API
 * Tests GET /api/admin/badges for fetching raw badge scan events
 */

import { GET } from '@/app/api/admin/badges/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

// Mock NextAuth
jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn(),
}));

jest.mock('@/app/api/auth/[...nextauth]/route', () => ({
    authOptions: {}
}));

describe('Admin Badges API Integration Tests', () => {
    let testAdminId: number;
    let testUserId: number;
    let testBadgeEventId: number;

    beforeAll(async () => {
        // Clean up any leaked state
        await prisma.rawBadgeEvent.deleteMany({
            where: {
                participant: { email: { contains: 'badges-api-test' } }
            }
        });
        await prisma.participant.deleteMany({
            where: { email: { contains: 'badges-api-test' } }
        });

        // Setup mock database records
        const admin = await prisma.participant.create({
            data: { email: 'admin-badges-api-test@example.com', name: 'Admin Badges Test', sysadmin: true }
        });
        testAdminId = admin.id;

        const user = await prisma.participant.create({
            data: { email: 'user-badges-api-test@example.com', name: 'User Badges Test' }
        });
        testUserId = user.id;

        const badgeEvent = await prisma.rawBadgeEvent.create({
            data: {
                participantId: testUserId,
                location: 'Front Door'
            }
        });
        testBadgeEventId = badgeEvent.id;
    });

    afterAll(async () => {
        // Clean up
        await prisma.rawBadgeEvent.deleteMany({
            where: { id: testBadgeEventId }
        });
        await prisma.participant.deleteMany({
            where: { id: { in: [testAdminId, testUserId] } }
        });
    });

    describe('GET /api/admin/badges', () => {
        it('should return 401 Unauthorized without session', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);

             const req = new Request('http://localhost:4000/api/admin/badges', {
                 method: 'GET'
             });

             const res = await GET(req as any);
             expect(res.status).toBe(403);
        });

        it('should return 403 Forbidden for non-admin users', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({
                 user: { id: testUserId, sysadmin: false, boardMember: false }
             });

             const req = new Request('http://localhost:4000/api/admin/badges', {
                 method: 'GET'
             });

             const res = await GET(req as any);
             expect(res.status).toBe(403);
             
             const data = await res.json();
             expect(data.error).toContain('Unauthorized: Requires Admin Role');
        });

        it('should successfully return recent raw badge events for admins', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, sysadmin: true, boardMember: false }
            });

            const req = new Request('http://localhost:4000/api/admin/badges', {
                method: 'GET'
            });

            const res = await GET(req as any);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.badges).toBeDefined();
            expect(Array.isArray(data.badges)).toBe(true);
            
            // Verify our test event is in the response with participant joined
            const foundEvent = data.badges.find((b: any) => b.id === testBadgeEventId);
            expect(foundEvent).toBeDefined();
            expect(foundEvent.location).toBe('Front Door');
            expect(foundEvent.participant).toBeDefined();
            expect(foundEvent.participant.name).toBe('User Badges Test');
            expect(foundEvent.participant.email).toBe('user-badges-api-test@example.com');
        });
    });
});
