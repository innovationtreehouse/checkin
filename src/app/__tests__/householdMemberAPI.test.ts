/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @jest-environment node
 */
/**
 * Integration Tests for User Household Member API
 * Tests PATCH /api/household/member for household leads editing their members
 */

import { PATCH } from '@/app/api/household/member/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

// Mock NextAuth
jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn()
}));
jest.mock('@/app/api/auth/[...nextauth]/route', () => ({
    authOptions: {}
}));

describe('Household Member API Integration Tests', () => {
    let testLeadId: number;
    let testMemberId: number;
    let testNonLeadId: number;
    let testOtherMemberId: number;
    let householdId: number;
    let otherHouseholdId: number;

    beforeAll(async () => {
        // Clean up any leaked state
        const existingUsers = await prisma.participant.findMany({
            where: { email: { contains: 'member-api-test' } },
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
        const household = await prisma.household.create({
            data: { name: 'Member Test Household' }
        });
        householdId = household.id;

        const leadUser = await prisma.participant.create({
            data: { email: 'lead-member-api-test@example.com', name: 'Lead User', householdId: household.id }
        });
        testLeadId = leadUser.id;

        await prisma.householdLead.create({
            data: { householdId: household.id, participantId: leadUser.id }
        });

        const memberUser = await prisma.participant.create({
            data: { email: 'child-member-api-test@example.com', name: 'Child User', householdId: household.id }
        });
        testMemberId = memberUser.id;

        const nonLeadUser = await prisma.participant.create({
            data: { email: 'nonlead-member-api-test@example.com', name: 'Non-Lead Adult', householdId: household.id }
        });
        testNonLeadId = nonLeadUser.id;

        const otherHousehold = await prisma.household.create({
            data: { name: 'Other Member Test Household' }
        });
        otherHouseholdId = otherHousehold.id;

        const otherMember = await prisma.participant.create({
            data: { email: 'other-child-member-api-test@example.com', name: 'Other Child', householdId: otherHousehold.id }
        });
        testOtherMemberId = otherMember.id;
    });

    afterAll(async () => {
        const currentIds = [testLeadId, testMemberId, testNonLeadId, testOtherMemberId];
        const validHouseholdIds = [householdId, otherHouseholdId];

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
        
        await prisma.household.deleteMany({
            where: { id: { in: validHouseholdIds } }
        });
    });

    describe('PATCH /api/household/member', () => {
        it('should return 401 Unauthorized without session', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);

             const req = new Request('http://localhost:4000/api/household/member', {
                 method: 'PATCH',
                 body: JSON.stringify({ participantId: testMemberId, name: 'Changed' })
             });
             const res = await PATCH(req as any);
             expect(res.status).toBe(401);
        });

        it('should return 400 Bad Request if participantId is omitted', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: testLeadId } });

            const req = new Request('http://localhost:4000/api/household/member', {
                method: 'PATCH',
                body: JSON.stringify({ name: 'Changed' })
            });

            const res = await PATCH(req as any);
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toBe('Participant ID is required');
        });

        it('should reject if the submitting user is not a lead', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: testNonLeadId } });

            const req = new Request('http://localhost:4000/api/household/member', {
                method: 'PATCH',
                body: JSON.stringify({ participantId: testMemberId, name: 'Changed' })
            });

            const res = await PATCH(req as any);
            expect(res.status).toBe(403);
            const data = await res.json();
            expect(data.error).toBe('Only household leads can edit members');
        });

        it('should return 404 Not Found if trying to edit a member outside of your household', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: testLeadId } });

            const req = new Request('http://localhost:4000/api/household/member', {
                method: 'PATCH',
                body: JSON.stringify({ participantId: testOtherMemberId, name: 'Stolen' })
            });

            const res = await PATCH(req as any);
            expect(res.status).toBe(404);
            const data = await res.json();
            expect(data.error).toBe('Member not found in your household');
        });

        it('should successfully update a household member', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: testLeadId } });

            const newDob = '2010-05-15';
            const req = new Request('http://localhost:4000/api/household/member', {
                method: 'PATCH',
                body: JSON.stringify({ 
                    participantId: testMemberId, 
                    name: 'Updated Child', 
                    email: 'updated-child@example.com',
                    dob: newDob,
                    phone: '555-555-5555'
                })
            });

            const res = await PATCH(req as any);
            expect(res.status).toBe(200);
            
            const data = await res.json();
            expect(data.member).toBeDefined();
            expect(data.message).toBe('Member updated successfully.');

            // Validate the changes
            const updatedProfile = await prisma.participant.findUnique({ where: { id: testMemberId } });
            expect(updatedProfile?.name).toBe('Updated Child');
            expect(updatedProfile?.email).toBe('updated-child@example.com');
            expect(updatedProfile?.phone).toBe('555-555-5555');
            expect(updatedProfile?.dob?.toISOString().startsWith(newDob)).toBe(true);

            // Verify Audit Trail is populated
            const auditLogs = await prisma.auditLog.findMany({
                where: { actorId: testLeadId, action: 'EDIT', tableName: 'Participant', affectedEntityId: testMemberId }
            });
            expect(auditLogs.length).toBeGreaterThan(0);
        });

        it('should blank out email and dob if empty strings are sent', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: testLeadId } });

            const req = new Request('http://localhost:4000/api/household/member', {
                method: 'PATCH',
                body: JSON.stringify({ 
                    participantId: testMemberId, 
                    email: '',
                    dob: '',
                    phone: ''
                })
            });

            const res = await PATCH(req as any);
            expect(res.status).toBe(200);

            const updatedProfile = await prisma.participant.findUnique({ where: { id: testMemberId } });
            expect(updatedProfile?.email).toBeNull();
            expect(updatedProfile?.dob).toBeNull();
            expect(updatedProfile?.phone).toBeNull();
        });
    });
});
