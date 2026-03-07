/**
 * @jest-environment node
 */
/**
 * Integration Tests for User Household API
 * Tests GET, POST, and PATCH /api/household for regular users managing their household
 */

import { GET, POST, PATCH } from '@/app/api/household/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

// Mock NextAuth
jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn()
}));
jest.mock('@/app/api/auth/[...nextauth]/route', () => ({
    authOptions: {}
}));

describe('Household API Integration Tests', () => {
    let testUserId: number;
    let testMemberId: number;
    let testNoHouseId: number;
    let testOtherHouseUserId: number;
    let householdId: number;
    let otherHouseholdId: number;

    beforeAll(async () => {
        // Clean up any leaked state
        const existingUsers = await prisma.participant.findMany({
            where: { email: { contains: 'household-api-test' } },
            select: { id: true, householdId: true }
        });
        
        const existingUserIds = existingUsers.map(u => u.id);
        const existingHouseholdIds = existingUsers.map(u => u.householdId).filter(id => id !== null) as number[];
        
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
        const userWithoutHousehold = await prisma.participant.create({
            data: { email: 'nohouse-user-household-api-test@example.com', name: 'No House User' }
        });
        testNoHouseId = userWithoutHousehold.id;

        const household = await prisma.household.create({
            data: { name: 'Lead User Household', address: '123 Main' }
        });
        householdId = household.id;

        const leadUser = await prisma.participant.create({
            data: { email: 'lead-user-household-api-test@example.com', name: 'Lead User', householdId: household.id }
        });
        testUserId = leadUser.id;

        await prisma.householdLead.create({
            data: { householdId: household.id, participantId: leadUser.id }
        });

        const memberUser = await prisma.participant.create({
            data: { email: 'member-user-household-api-test@example.com', name: 'Member User', householdId: household.id }
        });
        testMemberId = memberUser.id;

        const otherHousehold = await prisma.household.create({
            data: { name: 'Other Household' }
        });
        otherHouseholdId = otherHousehold.id;

        const otherUser = await prisma.participant.create({
            data: { email: 'other-household-api-test@example.com', name: 'Other User', householdId: otherHousehold.id }
        });
        testOtherHouseUserId = otherUser.id;
    });

    afterAll(async () => {
        // Find trailing records created during test
        const newDobs = await prisma.participant.findMany({
            where: { email: 'new-child-household-api-test@example.com' },
            select: { id: true, householdId: true }
        });
        const currentIds = [testUserId, testMemberId, testNoHouseId, testOtherHouseUserId, ...(newDobs.map(u => u.id))];

        await prisma.householdLead.deleteMany({
            where: { participantId: { in: currentIds } }
        });
        
        const validHouseholdIds = [householdId, otherHouseholdId].filter(id => id !== undefined);
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

        // Delete any households created by test (from NO house user)
        const checkNoHouseUser = await prisma.participant.findUnique({
            where: { id: testNoHouseId },
            include: { household: true }
        });
        if (checkNoHouseUser?.householdId) {
            await prisma.membership.deleteMany({ where: { householdId: checkNoHouseUser.householdId } });
            await prisma.participant.updateMany({ where: { householdId: checkNoHouseUser.householdId }, data: { householdId: null } });
            await prisma.household.deleteMany({ where: { id: checkNoHouseUser.householdId } });
        }

        await prisma.participant.deleteMany({
            where: { id: { in: currentIds } }
        });
        
        if (validHouseholdIds.length > 0) {
            await prisma.household.deleteMany({
                where: { id: { in: validHouseholdIds } }
            });
        }
    });

    describe('GET /api/household', () => {
        it('should return 401 Unauthorized without session', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);

             const req = new Request('http://localhost:4000/api/household', { method: 'GET' });
             const res = await GET(req as any);
             expect(res.status).toBe(401);
        });

        it('should return household info if the user belongs to one', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testUserId }
            });

            const req = new Request('http://localhost:4000/api/household', { method: 'GET' });
            const res = await GET(req as any);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.household).toBeDefined();
            expect(data.household.id).toBe(householdId);
            expect(data.household.participants.length).toBeGreaterThanOrEqual(2);
        });
    });

    describe('POST /api/household', () => {
        it('should block users who already have a household', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: testUserId } });

            const req = new Request('http://localhost:4000/api/household', { method: 'POST' });
            const res = await POST(req as any);
            
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toBe('User already belongs to a household');
        });

        it('should create a new household for a user without one', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: testNoHouseId } });

            const req = new Request('http://localhost:4000/api/household', { method: 'POST' });
            const res = await POST(req as any);
            
            expect(res.status).toBe(201);
            const data = await res.json();
            
            expect(data.household).toBeDefined();
            expect(data.household.name).toBe('User Household');

            // Verify they are lead
            const isLead = data.household.leads.some((l: any) => l.participantId === testNoHouseId);
            expect(isLead).toBe(true);

            // Need to clean this newly created household up in afterAll, already handled
        });
    });

    describe('PATCH /api/household', () => {
        it('should return 401 without session', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(null);

            const req = new Request('http://localhost:4000/api/household', {
                method: 'PATCH',
                body: JSON.stringify({ memberName: 'Child' })
            });

            const res = await PATCH(req as any);
            expect(res.status).toBe(401);
        });

        it('should reject if the submitting user is not a lead', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: testMemberId } });

            const req = new Request('http://localhost:4000/api/household', {
                method: 'PATCH',
                body: JSON.stringify({ memberName: 'Child' })
            });

            const res = await PATCH(req as any);
            expect(res.status).toBe(403);
            const data = await res.json();
            expect(data.error).toBe('Only household leads can add members');
        });

        it('should reject if trying to link an account already in another household', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: testUserId } });

            const req = new Request('http://localhost:4000/api/household', {
                method: 'PATCH',
                body: JSON.stringify({ memberName: 'T', memberEmail: 'other-household-api-test@example.com' })
            });

            const res = await PATCH(req as any);
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toBe('A user with this email already belongs to a household.');
        });

        it('should successfully add a new child record', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: testUserId } });

            const req = new Request('http://localhost:4000/api/household', {
                method: 'PATCH',
                body: JSON.stringify({ memberName: 'New Child', memberEmail: 'new-child-household-api-test@example.com' })
            });

            const res = await PATCH(req as any);
            expect(res.status).toBe(200);
            
            const data = await res.json();
            expect(data.member).toBeDefined();
            expect(data.member.name).toBe('New Child');
            expect(data.member.householdId).toBe(householdId);
        });
    });
});
