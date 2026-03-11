/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @jest-environment node
 */
/**
 * Integration Tests for Program Publish API
 * Tests POST /api/programs/[id]/publish for activating planned programs
 */

import { POST } from '@/app/api/programs/[id]/publish/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';

// Mock NextAuth
jest.mock('next-auth', () => ({
    getServerSession: jest.fn()
}));
jest.mock('@/app/api/auth/[...nextauth]/route', () => ({
    authOptions: {}
}));

describe('Program Publish API Integration Tests', () => {
    let adminId: number;
    let leadId: number;
    let commonId: number;
    
    let validProgramId: number;
    let noLeadProgramId: number;
    let noEventsProgramId: number;

    beforeAll(async () => {
        // Clean up any leaked state
        const existingUsers = await prisma.participant.findMany({
            where: { email: { contains: 'publish-api-test' } },
            select: { id: true }
        });
        const existingUserIds = existingUsers.map(u => u.id);
        
        await prisma.event.deleteMany({
            where: { name: { contains: 'Publish API Test' } }
        });

        await prisma.program.deleteMany({
            where: { name: { contains: 'Publish API Test' } }
        });
        
        await prisma.auditLog.deleteMany({
            where: { actorId: { in: existingUserIds } }
        });
        
        await prisma.participant.deleteMany({
            where: { id: { in: existingUserIds } }
        });

        // Create Admin
        const admin = await prisma.participant.create({
            data: { email: 'admin-publish-api-test@example.com', name: 'Admin', sysadmin: true }
        });
        adminId = admin.id;

        // Create Lead
        const lead = await prisma.participant.create({
            data: { email: 'lead-publish-api-test@example.com', name: 'Lead' }
        });
        leadId = lead.id;

        // Create Common User
        const commonUser = await prisma.participant.create({
            data: { email: 'common-publish-api-test@example.com', name: 'Common' }
        });
        commonId = commonUser.id;

        // Create mock programs
        const validProgram = await prisma.program.create({
            data: { 
                name: 'Valid Publish API Test', 
                phase: 'PLANNING', 
                leadMentorId: leadId,
                events: {
                    create: {
                        name: 'Publish API Test Event',
                        start: new Date(Date.now() + 86400000),
                        end: new Date(Date.now() + 90000000)
                    }
                }
            }
        });
        validProgramId = validProgram.id;

        const noLeadProgram = await prisma.program.create({
            data: { 
                name: 'No Lead Publish API Test', 
                phase: 'PLANNING',
                events: {
                    create: {
                        name: 'No Lead Publish API Test Event',
                        start: new Date(Date.now() + 86400000),
                        end: new Date(Date.now() + 90000000)
                    }
                }
            }
        });
        noLeadProgramId = noLeadProgram.id;

        const noEventsProgram = await prisma.program.create({
            data: { 
                name: 'No Events Publish API Test', 
                phase: 'PLANNING', 
                leadMentorId: leadId
            }
        });
        noEventsProgramId = noEventsProgram.id;
    });

    afterAll(async () => {
        const existingUserIds = [adminId, leadId, commonId];
        const validProgramIds = [validProgramId, noLeadProgramId, noEventsProgramId].filter(id => id !== undefined);

        await prisma.event.deleteMany({
            where: { programId: { in: validProgramIds } }
        });

        await prisma.program.deleteMany({
            where: { id: { in: validProgramIds } }
        });
        
        await prisma.auditLog.deleteMany({
            where: { actorId: { in: existingUserIds } }
        });
        
        await prisma.participant.deleteMany({
            where: { id: { in: existingUserIds } }
        });
    });

    const createParams = (id: number) => ({ params: Promise.resolve({ id: id.toString() }) });

    describe('POST /api/programs/[id]/publish', () => {
        it('should return 401 Unauthorized without session', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);

             const req = new Request(`http://localhost:4000/api/programs/${validProgramId}/publish`, {
                 method: 'POST',
                 body: JSON.stringify({ publish: true })
             });
             const res = await POST(req as any, createParams(validProgramId) as any);
             expect(res.status).toBe(401);
        });

        it('should return 400 Bad Request if publish flag is false', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId } });

             const req = new Request(`http://localhost:4000/api/programs/${validProgramId}/publish`, {
                 method: 'POST',
                 body: JSON.stringify({ publish: false })
             });
             const res = await POST(req as any, createParams(validProgramId) as any);
             expect(res.status).toBe(400);
             const data = await res.json();
             expect(data.error).toBe("publish must be true");
        });

        it('should return 404 Not Found for non-existent program', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, sysadmin: true } });

             const req = new Request('http://localhost:4000/api/programs/999999/publish', {
                 method: 'POST',
                 body: JSON.stringify({ publish: true })
             });
             const res = await POST(req as any, createParams(999999) as any);
             expect(res.status).toBe(404);
        });

        it('should block common users from publishing', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const req = new Request(`http://localhost:4000/api/programs/${validProgramId}/publish`, {
                 method: 'POST',
                 body: JSON.stringify({ publish: true })
             });
             const res = await POST(req as any, createParams(validProgramId) as any);
             expect(res.status).toBe(403);
             const data = await res.json();
             expect(data.error).toMatch(/Forbidden/);
        });

        it('should return 400 Bad Request if no lead mentor is assigned', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, sysadmin: true } });

             const req = new Request(`http://localhost:4000/api/programs/${noLeadProgramId}/publish`, {
                 method: 'POST',
                 body: JSON.stringify({ publish: true })
             });
             const res = await POST(req as any, createParams(noLeadProgramId) as any);
             expect(res.status).toBe(400);
             const data = await res.json();
             expect(data.error).toBe('Cannot publish a program without a Lead Mentor assigned');
        });

        it('should return 400 Bad Request if no events are scheduled', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, sysadmin: true } });

             const req = new Request(`http://localhost:4000/api/programs/${noEventsProgramId}/publish`, {
                 method: 'POST',
                 body: JSON.stringify({ publish: true })
             });
             const res = await POST(req as any, createParams(noEventsProgramId) as any);
             expect(res.status).toBe(400);
             const data = await res.json();
             expect(data.error).toBe('Cannot publish a program without any scheduled events');
        });

        it('should allow the lead mentor to publish a fully configured program', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: leadId } });

             const req = new Request(`http://localhost:4000/api/programs/${validProgramId}/publish`, {
                 method: 'POST',
                 body: JSON.stringify({ publish: true })
             });
             const res = await POST(req as any, createParams(validProgramId) as any);
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.success).toBe(true);
             expect(data.program.phase).toBe('UPCOMING');
             expect(data.program.enrollmentStatus).toBe('OPEN');

             // Verify Audits
             const auditLogs = await prisma.auditLog.findMany({
                 where: { actorId: leadId, action: 'EDIT', tableName: 'Program', affectedEntityId: validProgramId }
             });
             expect(auditLogs.length).toBeGreaterThan(0);
        });
    });
});
