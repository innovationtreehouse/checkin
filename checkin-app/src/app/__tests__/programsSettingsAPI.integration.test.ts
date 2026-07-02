/**
 * @jest-environment node
 */
/**
 * Integration Tests for Program Settings API
 * Tests PATCH /api/programs/[id]/settings for updating program configurations
 */

import { PATCH } from '@/app/api/programs/[id]/settings/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
// Mock NextAuth
jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn(),
}));
describe('Program Settings API Integration Tests', () => {
    let adminId: number;
    let leadId: number;
    let commonId: number;
    let newLeadId: number;
    
    let targetProgramId: number;

    beforeAll(async () => {
        // Clean up any leaked state
        const existingUsers = await prisma.person.findMany({
            where: { email: { contains: 'settings-api-test' } },
            select: { id: true }
        });
        const existingUserIds = existingUsers.map(u => u.id);

        await prisma.program.deleteMany({
            where: { name: { contains: 'Settings API Test' } }
        });
        
        await prisma.auditLog.deleteMany({
            where: { actorId: { in: existingUserIds } }
        });
        
        await prisma.person.deleteMany({
            where: { id: { in: existingUserIds } }
        });

        // Create Admin
        const admin = await prisma.person.create({
            data: { email: 'admin-settings-api-test@example.com', name: 'Admin', isSysadmin: true, household: { create: {} } }
        });
        adminId = admin.id;

        // Create Lead
        const lead = await prisma.person.create({
            data: { email: 'lead-settings-api-test@example.com', name: 'Lead', household: { create: {} } }
        });
        leadId = lead.id;

        // Create New Lead Candidate
        const newLead = await prisma.person.create({
            data: { email: 'newlead-settings-api-test@example.com', name: 'New Lead', household: { create: {} } }
        });
        newLeadId = newLead.id;

        // Create Common User
        const commonUser = await prisma.person.create({
            data: { email: 'common-settings-api-test@example.com', name: 'Common', household: { create: {} } }
        });
        commonId = commonUser.id;

        // Create mock program
        const program = await prisma.program.create({
            data: { name: 'Settings API Test Program', phase: 'PLANNING', leadMentorId: leadId }
        });
        targetProgramId = program.id;
    });

    afterAll(async () => {
        const existingUserIds = [adminId, leadId, newLeadId, commonId].filter(id => id !== undefined);

        if (targetProgramId) {
            await prisma.programParticipant.deleteMany({
                where: { programId: targetProgramId }
            });
            await prisma.program.deleteMany({
                where: { id: targetProgramId }
            });
        }
        
        if (existingUserIds.length > 0) {
            await prisma.auditLog.deleteMany({
                where: { actorId: { in: existingUserIds } }
            });
            
            await prisma.person.deleteMany({
                where: { id: { in: existingUserIds } }
            });
        }
    });

    const createParams = (id: number) => ({ params: Promise.resolve({ id: id.toString() }) });

    describe('PATCH /api/programs/[id]/settings', () => {
        it('should return 401 Unauthorized without session', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);

             const req = new Request(`http://localhost:4000/api/programs/${targetProgramId}/settings`, {
                 method: 'PATCH',
                 body: JSON.stringify({ phase: 'RUNNING' })
             });
             const res = await PATCH(req as unknown as import("next/server").NextRequest, createParams(targetProgramId) as unknown as never);
             expect(res.status).toBe(401);
        });

        it('should block common users from updating settings', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const req = new Request(`http://localhost:4000/api/programs/${targetProgramId}/settings`, {
                 method: 'PATCH',
                 body: JSON.stringify({ name: 'Hacked Settings Program' })
             });
             const res = await PATCH(req as unknown as import("next/server").NextRequest, createParams(targetProgramId) as unknown as never);
             expect(res.status).toBe(403);
             
             const data = await res.json();
             expect(data.error).toMatch(/Forbidden/);
        });

        it('should allow the assigned lead mentor to update general settings', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: leadId } });

             const req = new Request(`http://localhost:4000/api/programs/${targetProgramId}/settings`, {
                 method: 'PATCH',
                 body: JSON.stringify({ maxParticipants: 30, minAge: 15 })
             });
             const res = await PATCH(req as unknown as import("next/server").NextRequest, createParams(targetProgramId) as unknown as never);
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.success).toBe(true);
             expect(data.program.maxParticipants).toBe(30);
             expect(data.program.minAge).toBe(15);
        });

        it('should block the lead mentor from reassigning the leadMentorId', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: leadId } });

             const req = new Request(`http://localhost:4000/api/programs/${targetProgramId}/settings`, {
                 method: 'PATCH',
                 body: JSON.stringify({ leadMentorId: newLeadId }) // lead attempting to hand off control
             });
             const res = await PATCH(req as unknown as import("next/server").NextRequest, createParams(targetProgramId) as unknown as never);
             expect(res.status).toBe(403);
             
             const data = await res.json();
             expect(data.error).toBe('Forbidden: Only administrators can reassign lead mentors');
        });

        it('should allow admins to reassign the leadMentorId', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });

             const req = new Request(`http://localhost:4000/api/programs/${targetProgramId}/settings`, {
                 method: 'PATCH',
                 body: JSON.stringify({ leadMentorId: newLeadId, phase: 'RUNNING' })
             });
             const res = await PATCH(req as unknown as import("next/server").NextRequest, createParams(targetProgramId) as unknown as never);
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.success).toBe(true);
             expect(data.program.leadMentorId).toBe(newLeadId);
             expect(data.program.phase).toBe('RUNNING');
        });

        it('should reject a negative maxParticipants with 400', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });

             const req = new Request(`http://localhost:4000/api/programs/${targetProgramId}/settings`, {
                 method: 'PATCH',
                 body: JSON.stringify({ maxParticipants: -5 })
             });
             const res = await PATCH(req as unknown as import("next/server").NextRequest, createParams(targetProgramId) as unknown as never);
             expect(res.status).toBe(400);
        });

        it('should reject a zero maxParticipants with 400', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });

             const req = new Request(`http://localhost:4000/api/programs/${targetProgramId}/settings`, {
                 method: 'PATCH',
                 body: JSON.stringify({ maxParticipants: 0 })
             });
             const res = await PATCH(req as unknown as import("next/server").NextRequest, createParams(targetProgramId) as unknown as never);
             expect(res.status).toBe(400);
        });

        it('should reject shrinking maxParticipants below current enrollment and not persist it', async () => {
             // Enroll 2 participants.
             await prisma.programParticipant.createMany({
                 data: [
                     { programId: targetProgramId, personId: commonId, status: 'ACTIVE' },
                     { programId: targetProgramId, personId: leadId, status: 'PENDING' },
                 ]
             });

             const before = await prisma.program.findUnique({ where: { id: targetProgramId } });

             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });

             const req = new Request(`http://localhost:4000/api/programs/${targetProgramId}/settings`, {
                 method: 'PATCH',
                 body: JSON.stringify({ maxParticipants: 1 }) // below enrollment of 2
             });
             const res = await PATCH(req as unknown as import("next/server").NextRequest, createParams(targetProgramId) as unknown as never);
             expect(res.status).toBe(400);

             const data = await res.json();
             expect(data.error).toMatch(/current enrollment of 2/);

             // Value did NOT persist.
             const after = await prisma.program.findUnique({ where: { id: targetProgramId } });
             expect(after?.maxParticipants).toBe(before?.maxParticipants);
        });

        it('should allow editing maxAge after creation (regression: was non-updatable)', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });

             const req = new Request(`http://localhost:4000/api/programs/${targetProgramId}/settings`, {
                 method: 'PATCH',
                 body: JSON.stringify({ maxAge: 18 })
             });
             const res = await PATCH(req as unknown as import("next/server").NextRequest, createParams(targetProgramId) as unknown as never);
             expect(res.status).toBe(200);

             const data = await res.json();
             expect(data.program.maxAge).toBe(18);

             const persisted = await prisma.program.findUnique({ where: { id: targetProgramId } });
             expect(persisted?.maxAge).toBe(18);
        });

        it('should reject minAge greater than maxAge with 400', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });

             const req = new Request(`http://localhost:4000/api/programs/${targetProgramId}/settings`, {
                 method: 'PATCH',
                 body: JSON.stringify({ minAge: 30, maxAge: 10 })
             });
             const res = await PATCH(req as unknown as import("next/server").NextRequest, createParams(targetProgramId) as unknown as never);
             expect(res.status).toBe(400);
        });
    });
});
