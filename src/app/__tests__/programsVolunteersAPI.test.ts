/**
 * @jest-environment node
 */
/**
 * Integration Tests for Program Volunteers API
 * Tests POST, PATCH, and DELETE /api/programs/[id]/volunteers for managing staff
 */

import { POST, PATCH, DELETE } from '@/app/api/programs/[id]/volunteers/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';

// Mock NextAuth
jest.mock('next-auth', () => ({
    getServerSession: jest.fn()
}));
jest.mock('@/app/api/auth/[...nextauth]/route', () => ({
    authOptions: {}
}));

describe('Program Volunteers API Integration Tests', () => {
    let adminId: number;
    let leadId: number;
    let commonId: number;
    
    let candidateId: number; // For testing POST
    let existingVolunteerId: number; // For testing PATCH & DELETE
    
    let targetProgramId: number;

    beforeAll(async () => {
        // Clean up any leaked state
        const existingUsers = await prisma.participant.findMany({
            where: { email: { contains: 'volun-api-test' } },
            select: { id: true }
        });
        const existingUserIds = existingUsers.map(u => u.id);
        
        await prisma.programVolunteer.deleteMany({
            where: { participantId: { in: existingUserIds } }
        });

        await prisma.program.deleteMany({
            where: { name: { contains: 'Volun API Test' } }
        });
        
        await prisma.auditLog.deleteMany({
            where: { actorId: { in: existingUserIds } }
        });
        
        await prisma.participant.deleteMany({
            where: { id: { in: existingUserIds } }
        });

        // Create Roles
        const admin = await prisma.participant.create({
            data: { email: 'admin-volun-api-test@example.com', name: 'Admin', sysadmin: true }
        });
        adminId = admin.id;

        const lead = await prisma.participant.create({
            data: { email: 'lead-volun-api-test@example.com', name: 'Lead' }
        });
        leadId = lead.id;

        const commonUser = await prisma.participant.create({
            data: { email: 'common-volun-api-test@example.com', name: 'Common' }
        });
        commonId = commonUser.id;

        const candidate = await prisma.participant.create({
            data: { email: 'candidate-volun-api-test@example.com', name: 'Candidate' }
        });
        candidateId = candidate.id;

        const existingVol = await prisma.participant.create({
            data: { email: 'existing-volun-api-test@example.com', name: 'Existing Volunteer' }
        });
        existingVolunteerId = existingVol.id;

        // Create mock program
        const program = await prisma.program.create({
            data: { 
                name: 'Volun API Test Program', 
                phase: 'RUNNING', 
                leadMentorId: leadId,
                volunteers: {
                    create: { participantId: existingVolunteerId, isCore: false }
                }
            }
        });
        targetProgramId = program.id;
    });

    afterAll(async () => {
        const existingUserIds = [adminId, leadId, commonId, candidateId, existingVolunteerId].filter(id => id !== undefined);

        if (existingUserIds.length > 0) {
            await prisma.programVolunteer.deleteMany({
                where: { participantId: { in: existingUserIds } }
            });
        }

        if (targetProgramId) {
            await prisma.program.deleteMany({
                where: { id: targetProgramId }
            });
        }
        
        if (existingUserIds.length > 0) {
            await prisma.auditLog.deleteMany({
                where: { actorId: { in: existingUserIds } }
            });
            
            await prisma.participant.deleteMany({
                where: { id: { in: existingUserIds } }
            });
        }
    });

    const createParams = (id: number) => ({ params: Promise.resolve({ id: id.toString() }) });

    describe('POST /api/programs/[id]/volunteers', () => {
        it('should return 401 Unauthorized without session', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);

             const req = new Request(`http://localhost:4000/api/programs/${targetProgramId}/volunteers`, {
                 method: 'POST',
                 body: JSON.stringify({ participantId: candidateId })
             });
             const res = await POST(req as any, createParams(targetProgramId) as any);
             expect(res.status).toBe(401);
        });

        it('should block common users from assigning a volunteer', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const req = new Request(`http://localhost:4000/api/programs/${targetProgramId}/volunteers`, {
                 method: 'POST',
                 body: JSON.stringify({ participantId: candidateId })
             });
             const res = await POST(req as any, createParams(targetProgramId) as any);
             expect(res.status).toBe(403);
             
             const data = await res.json();
             expect(data.error).toMatch(/Forbidden/);
        });

        it('should allow the program lead to assign a new volunteer', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: leadId } });

             const req = new Request(`http://localhost:4000/api/programs/${targetProgramId}/volunteers`, {
                 method: 'POST',
                 body: JSON.stringify({ participantId: candidateId })
             });
             const res = await POST(req as any, createParams(targetProgramId) as any);
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.success).toBe(true);
             expect(data.assignment.isCore).toBe(false); // Default logic
             expect(data.assignment.participantId).toBe(candidateId);
        });
    });

    describe('PATCH /api/programs/[id]/volunteers', () => {
        it('should block common users from updating a volunteer', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const req = new Request(`http://localhost:4000/api/programs/${targetProgramId}/volunteers`, {
                 method: 'PATCH',
                 body: JSON.stringify({ participantId: existingVolunteerId, isCore: true })
             });
             const res = await PATCH(req as any, createParams(targetProgramId) as any);
             expect(res.status).toBe(403);
        });

        it('should require isCore and participantId', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, sysadmin: true } });

             const req = new Request(`http://localhost:4000/api/programs/${targetProgramId}/volunteers`, {
                 method: 'PATCH',
                 body: JSON.stringify({ participantId: existingVolunteerId }) // missing isCore
             });
             const res = await PATCH(req as any, createParams(targetProgramId) as any);
             expect(res.status).toBe(400);
             
             const data = await res.json();
             expect(data.error).toBe("participantId and isCore are required");
        });

        it('should allow admins to toggle the isCore flag of a volunteer', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, sysadmin: true } });

             const req = new Request(`http://localhost:4000/api/programs/${targetProgramId}/volunteers`, {
                 method: 'PATCH',
                 body: JSON.stringify({ participantId: existingVolunteerId, isCore: true })
             });
             const res = await PATCH(req as any, createParams(targetProgramId) as any);
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.assignment.isCore).toBe(true);
        });
    });

    describe('DELETE /api/programs/[id]/volunteers', () => {
        it('should block common users from removing a volunteer', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const req = new Request(`http://localhost:4000/api/programs/${targetProgramId}/volunteers`, {
                 method: 'DELETE',
                 body: JSON.stringify({ participantId: existingVolunteerId })
             });
             const res = await DELETE(req as any, createParams(targetProgramId) as any);
             expect(res.status).toBe(403);
        });

        it('should allow the assigned lead mentor to remove a volunteer', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: leadId } });

             const req = new Request(`http://localhost:4000/api/programs/${targetProgramId}/volunteers`, {
                 method: 'DELETE',
                 body: JSON.stringify({ participantId: existingVolunteerId })
             });
             const res = await DELETE(req as any, createParams(targetProgramId) as any);
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.success).toBe(true);
             expect(data.assignment.participantId).toBe(existingVolunteerId);
        });
    });
});
