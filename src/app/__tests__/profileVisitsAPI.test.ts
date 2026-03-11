/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @jest-environment node
 */
/**
 * Integration Tests for Profile Visits API
 * Tests GET /api/profile/visits for users viewing their own recent check-ins
 */

import { GET } from '@/app/api/profile/visits/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

// Mock NextAuth
jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn()
}));
jest.mock('@/app/api/auth/[...nextauth]/route', () => ({
    authOptions: {}
}));

describe('Profile Visits API Integration Tests', () => {
    let testUserId: number;

    beforeAll(async () => {
        // Clean up any leaked state
        const existingUsers = await prisma.participant.findMany({
            where: { email: { contains: 'profile-visits-api-test' } },
            select: { id: true }
        });
        
        const existingUserIds = existingUsers.map(u => u.id);
        
        await prisma.visit.deleteMany({
            where: { participantId: { in: existingUserIds } }
        });
        
        await prisma.participant.deleteMany({
            where: { id: { in: existingUserIds } }
        });

        // Setup mock database records
        const user = await prisma.participant.create({
            data: { email: 'user-profile-visits-test@example.com', name: 'Profile Visits Tester' }
        });
        testUserId = user.id;

        const now = new Date();

        // Create visits for the test user
        await prisma.visit.createMany({
            data: [
                { participantId: testUserId, arrived: new Date(now.getTime() - 1000) }, // Just now
                { participantId: testUserId, arrived: new Date(now.getTime() - 86400000) }, // 1 day ago
                { participantId: testUserId, arrived: new Date(now.getTime() - 864000000) }, // 10 days ago (outside 7 day window)
            ]
        });
    });

    afterAll(async () => {
        await prisma.visit.deleteMany({
            where: { participantId: testUserId }
        });
        
        await prisma.participant.deleteMany({
            where: { id: testUserId }
        });
    });

    describe('GET /api/profile/visits', () => {
        it('should return 401 Unauthorized without session', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);

             const req = new Request('http://localhost:4000/api/profile/visits', { method: 'GET' });
             const res = await GET(req as any);
             expect(res.status).toBe(401);
        });

        it('should return visits for the user within default 7 day window', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: testUserId } });

            const req = new Request('http://localhost:4000/api/profile/visits', { method: 'GET' });
            const res = await GET(req as any);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(Array.isArray(data.visits)).toBe(true);
            
            // There are 3 visits total for the user, but 1 is 10 days old (outside default 7-day window)
            expect(data.visits.length).toBe(2);
        });

        it('should shift the visit window correctly when filter date is provided', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: testUserId } });

            // Look at exactly 9 days ago, window should be +/- 7 days from there (day -16 to day -2)
            const searchWindow = new Date(Date.now() - (9 * 86400000)).toISOString();
            
            const req = new Request(`http://localhost:4000/api/profile/visits?date=${encodeURIComponent(searchWindow)}`, { method: 'GET' });
            const res = await GET(req as any);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(Array.isArray(data.visits)).toBe(true);
            
            // It should only capture the 10-days-ago visit, missing the 1-day-ago and just-now visits
            expect(data.visits.length).toBe(1);
        });
    });
});
