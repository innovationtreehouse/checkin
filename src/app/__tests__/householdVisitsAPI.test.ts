/**
 * @jest-environment node
 */
/**
 * Integration Tests for User Household Visits API
 * Tests GET /api/household/visits for users viewing recent check-ins of their household
 */

import { GET } from '@/app/api/household/visits/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

// Mock NextAuth
jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn()
}));
jest.mock('@/app/api/auth/[...nextauth]/route', () => ({
    authOptions: {}
}));

describe('Household Visits API Integration Tests', () => {
    let testUserId: number;
    let testMemberId: number;
    let testOtherHouseUserId: number;
    let testNoHouseId: number;

    beforeAll(async () => {
        // Clean up any leaked state
        const existingUsers = await prisma.participant.findMany({
            where: { email: { contains: 'house-visits-api-test' } },
            select: { id: true, householdId: true }
        });
        
        const existingUserIds = existingUsers.map(u => u.id);
        const existingHouseholdIds = existingUsers.map(u => u.householdId).filter(id => id !== null) as number[];
        
        await prisma.visit.deleteMany({
            where: { participantId: { in: existingUserIds } }
        });

        await prisma.householdLead.deleteMany({
            where: { participantId: { in: existingUserIds } }
        });
        
        await prisma.membership.deleteMany({
            where: { householdId: { in: existingHouseholdIds } }
        });
        
        await prisma.auditLog.deleteMany({
            where: { actorId: { in: existingUserIds } }
        });
        
        await prisma.participant.updateMany({
            where: { id: { in: existingUserIds } },
            data: { householdId: null }
        });

        await prisma.participant.deleteMany({
            where: { id: { in: existingUserIds } }
        });
        
        await prisma.household.deleteMany({
            where: { id: { in: existingHouseholdIds } }
        });

        // Setup mock database records
        const household = await prisma.household.create({
            data: { name: 'Visits Test Household' }
        });

        const leadUser = await prisma.participant.create({
            data: { email: 'lead-house-visits-api-test@example.com', name: 'Lead User', householdId: household.id }
        });
        testUserId = leadUser.id;

        await prisma.householdLead.create({
            data: { householdId: household.id, participantId: leadUser.id }
        });

        const memberUser = await prisma.participant.create({
            data: { email: 'child-house-visits-api-test@example.com', name: 'Child User', householdId: household.id }
        });
        testMemberId = memberUser.id;

        const otherHousehold = await prisma.household.create({
            data: { name: 'Other Visits Test Household' }
        });

        const otherUser = await prisma.participant.create({
            data: { email: 'other-house-visits-api-test@example.com', name: 'Other User', householdId: otherHousehold.id }
        });
        testOtherHouseUserId = otherUser.id;

        const noHouseUser = await prisma.participant.create({
            data: { email: 'nohouse-visits-api-test@example.com', name: 'No House User' }
        });
        testNoHouseId = noHouseUser.id;

        const now = new Date();

        // Create visits for the test household
        await prisma.visit.createMany({
            data: [
                { participantId: leadUser.id, arrived: new Date(now.getTime() - 1000) }, // Just now
                { participantId: memberUser.id, arrived: new Date(now.getTime() - 86400000) }, // 1 day ago
                { participantId: leadUser.id, arrived: new Date(now.getTime() - 864000000) }, // 10 days ago (outside 7 day window)
            ]
        });

        // Create visit for other household
        await prisma.visit.create({
            data: { participantId: otherUser.id, arrived: new Date(now.getTime() - 2000) }
        });
    });

    afterAll(async () => {
        const currentIds = [testUserId, testMemberId, testOtherHouseUserId, testNoHouseId];
        
        const existingUsers = await prisma.participant.findMany({
            where: { id: { in: currentIds } },
            select: { householdId: true }
        });
        const validHouseholdIds = existingUsers.map(u => u.householdId).filter(id => id !== null) as number[];

        await prisma.visit.deleteMany({
            where: { participantId: { in: currentIds } }
        });

        await prisma.householdLead.deleteMany({
            where: { participantId: { in: currentIds } }
        });
        
        await prisma.membership.deleteMany({
            where: { householdId: { in: validHouseholdIds } }
        });
        
        await prisma.auditLog.deleteMany({
            where: { actorId: { in: currentIds } }
        });
        
        await prisma.participant.updateMany({
            where: { id: { in: currentIds } },
            data: { householdId: null }
        });

        await prisma.participant.deleteMany({
            where: { id: { in: currentIds } }
        });
        
        if (validHouseholdIds.length > 0) {
            await prisma.household.deleteMany({
                where: { id: { in: validHouseholdIds } }
            });
        }
    });

    describe('GET /api/household/visits', () => {
        it('should return 401 Unauthorized without session', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);

             const req = new Request('http://localhost:4000/api/household/visits', { method: 'GET' });
             const res = await GET(req as any);
             expect(res.status).toBe(401);
        });

        it('should return empty visits array if user has no household', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: testNoHouseId } });

            const req = new Request('http://localhost:4000/api/household/visits', { method: 'GET' });
            const res = await GET(req as any);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(Array.isArray(data.visits)).toBe(true);
            expect(data.visits.length).toBe(0);
        });

        it('should return only the visits for the users in their own household within default 7 day window', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: testUserId } });

            const req = new Request('http://localhost:4000/api/household/visits', { method: 'GET' });
            const res = await GET(req as any);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(Array.isArray(data.visits)).toBe(true);
            
            // There are 3 visits total for the household, but 1 is 10 days old (outside default 7-day window)
            expect(data.visits.length).toBe(2);
            
            // Verify no cross-pollution from other household
            const hasOtherHouseholdVisits = data.visits.some((v: any) => v.participantId === testOtherHouseUserId);
            expect(hasOtherHouseholdVisits).toBe(false);

            // Verify ordered correctly (descending)
            expect(data.visits[0].participantId).toBe(testUserId); // Just now
            expect(data.visits[1].participantId).toBe(testMemberId); // 1 day ago
        });

        it('should shift the visit window correctly when filter date is provided', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: testUserId } });

            // Look at exactly 9 days ago, window should be +/- 7 days from there (day -16 to day -2)
            const searchWindow = new Date(Date.now() - (9 * 86400000)).toISOString();
            
            const req = new Request(`http://localhost:4000/api/household/visits?date=${encodeURIComponent(searchWindow)}`, { method: 'GET' });
            const res = await GET(req as any);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(Array.isArray(data.visits)).toBe(true);
            
            // It should only capture the 10-days-ago visit, missing the 1-day-ago and just-now visits
            expect(data.visits.length).toBe(1);
            expect(data.visits[0].participantId).toBe(testUserId);
            // Verify it was the 10-days-ago visit (can't easily verify the exact MS but logically it is the third visit record)
        });
    });
});
