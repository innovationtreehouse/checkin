/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @jest-environment node
 */
/**
 * Integration Tests for User Household Lead API
 * Tests POST and DELETE /api/household/lead for household leads managing leads
 */

import { POST, DELETE } from '@/app/api/household/lead/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

// Mock NextAuth
jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn()
}));
jest.mock('@/app/api/auth/[...nextauth]/route', () => ({
    authOptions: {}
}));

describe('Household Lead API Integration Tests', () => {
    let testLeadId: number;
    let testAdultId: number;
    let testChildId: number;
    let testOtherLeadId: number;
    let testOtherMemberId: number;
    let householdId: number;
    let otherHouseholdId: number;

    beforeAll(async () => {
        // Clean up any leaked state
        const existingUsers = await prisma.participant.findMany({
            where: { email: { contains: 'lead-api-test' } },
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
            data: { name: 'Lead Test Household' }
        });
        householdId = household.id;

        const leadUser = await prisma.participant.create({
            data: { email: 'lead-lead-api-test@example.com', name: 'Lead User', householdId: household.id }
        });
        testLeadId = leadUser.id;

        await prisma.householdLead.create({
            data: { householdId: household.id, participantId: leadUser.id }
        });

        const adultUser = await prisma.participant.create({
            data: { email: 'adult-lead-api-test@example.com', name: 'Adult User', householdId: household.id }
        });
        testAdultId = adultUser.id;

        const childUser = await prisma.participant.create({
            data: { email: 'child-lead-api-test@example.com', name: 'Child User', householdId: household.id }
        });
        testChildId = childUser.id;

        const otherHousehold = await prisma.household.create({
            data: { name: 'Other Lead Test Household' }
        });
        otherHouseholdId = otherHousehold.id;
        
        const otherLead = await prisma.participant.create({
            data: { email: 'other-lead-lead-api-test@example.com', name: 'Other Lead User', householdId: otherHousehold.id }
        });
        testOtherLeadId = otherLead.id;

        await prisma.householdLead.create({
            data: { householdId: otherHousehold.id, participantId: otherLead.id }
        });

        const otherMember = await prisma.participant.create({
            data: { email: 'other-adult-lead-api-test@example.com', name: 'Other Adult', householdId: otherHousehold.id }
        });
        testOtherMemberId = otherMember.id;
    });

    afterAll(async () => {
        const currentIds = [testLeadId, testAdultId, testChildId, testOtherLeadId, testOtherMemberId];
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

    describe('POST /api/household/lead', () => {
        it('should return 401 Unauthorized without session', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);

             const req = new Request('http://localhost:4000/api/household/lead', {
                 method: 'POST',
                 body: JSON.stringify({ participantId: testAdultId })
             });
             const res = await POST(req as any);
             expect(res.status).toBe(401);
        });

        it('should reject if the submitting user is not a lead', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: testAdultId } });

            const req = new Request('http://localhost:4000/api/household/lead', {
                method: 'POST',
                body: JSON.stringify({ participantId: testChildId })
            });

            const res = await POST(req as any);
            expect(res.status).toBe(403);
            const data = await res.json();
            expect(data.error).toBe('Only household leads or sysadmins can promote members');
        });

        it('should return 404 Not Found if trying to promote a member outside of your household', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: testLeadId } });

            const req = new Request('http://localhost:4000/api/household/lead', {
                method: 'POST',
                body: JSON.stringify({ participantId: testOtherMemberId })
            });

            const res = await POST(req as any);
            expect(res.status).toBe(404);
            const data = await res.json();
            expect(data.error).toBe('Member not found in your household');
        });

        it('should return successfully when user is already a lead', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: testLeadId } });
             
             const req = new Request('http://localhost:4000/api/household/lead', {
                method: 'POST',
                body: JSON.stringify({ participantId: testLeadId })
            });
            const res = await POST(req as any);
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.message).toBe('Member is already a lead');
        });

        it('should successfully promote a household member to lead', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: testLeadId } });

            const req = new Request('http://localhost:4000/api/household/lead', {
                method: 'POST',
                body: JSON.stringify({ participantId: testAdultId })
            });

            const res = await POST(req as any);
            expect(res.status).toBe(200);
            
            const data = await res.json();
            expect(data.lead).toBeDefined();
            expect(data.message).toBe('Member promoted to lead successfully.');

            // Validate the changes
            const newLead = await prisma.householdLead.findUnique({ 
                where: { 
                    householdId_participantId: {
                        householdId: householdId,
                        participantId: testAdultId
                    }
                } 
            });
            expect(newLead).toBeDefined();

            // Verify Audit Trail is populated
            const auditLogs = await prisma.auditLog.findMany({
                where: { actorId: testLeadId, action: 'CREATE', tableName: 'HouseholdLead', secondaryAffectedEntity: testAdultId }
            });
            expect(auditLogs.length).toBeGreaterThan(0);
        });
    });
    
    describe('DELETE /api/household/lead', () => {
         it('should return 401 Unauthorized without session', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);

             const req = new Request('http://localhost:4000/api/household/lead', {
                 method: 'DELETE',
                 body: JSON.stringify({ participantId: testAdultId })
             });
             const res = await DELETE(req as any);
             expect(res.status).toBe(401);
        });
        
        it('should reject if the submitting user is not a lead', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: testChildId } });

            const req = new Request('http://localhost:4000/api/household/lead', {
                method: 'DELETE',
                body: JSON.stringify({ participantId: testAdultId })
            });

            const res = await DELETE(req as any);
            expect(res.status).toBe(403);
            const data = await res.json();
            expect(data.error).toBe('Only household leads or sysadmins can remove leads');
        });
        
         it('should fail when trying to remove the last lead', async () => {
             // We currently have two leads in `householdId`: testLeadId and testAdultId. 
             // Let's test `otherHouseholdId` which only has `testOtherLeadId`.
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: testOtherLeadId } });
             const req = new Request('http://localhost:4000/api/household/lead', {
                 method: 'DELETE',
                 body: JSON.stringify({ participantId: testOtherLeadId })
             });
             const res = await DELETE(req as any);
             expect(res.status).toBe(400);
             const data = await res.json();
             expect(data.error).toBe('Cannot remove the last lead of a household.');
         });
         
        it('should successfully remove a lead if multiple leads exist', async () => {
             // Currently `testAdultId` is a lead from the POST test
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: testLeadId } });

            const req = new Request('http://localhost:4000/api/household/lead', {
                method: 'DELETE',
                body: JSON.stringify({ participantId: testAdultId })
            });

            const res = await DELETE(req as any);
            expect(res.status).toBe(200);
            
            const data = await res.json();
            expect(data.message).toBe('Lead removed successfully.');

            // Validate the changes
            const demotedLead = await prisma.householdLead.findUnique({ 
                where: { 
                    householdId_participantId: {
                        householdId: householdId,
                        participantId: testAdultId
                    }
                } 
            });
            expect(demotedLead).toBeNull();
        });
    });
});
