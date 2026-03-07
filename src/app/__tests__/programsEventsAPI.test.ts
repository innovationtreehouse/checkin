/**
 * @jest-environment node
 */
/**
 * Integration Tests for Program Events API
 * Tests POST /api/programs/[id]/events for creating scheduled occurrences
 */

import { POST } from '@/app/api/programs/[id]/events/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';

// Mock NextAuth
jest.mock('next-auth', () => ({
    getServerSession: jest.fn()
}));
jest.mock('@/app/api/auth/[...nextauth]/route', () => ({
    authOptions: {}
}));

describe('Program Events API Integration Tests', () => {
    let adminId: number;
    let leadId: number;
    let commonId: number;
    let targetProgramId: number;

    beforeAll(async () => {
        // Clean up any leaked state
        const existingUsers = await prisma.participant.findMany({
            where: { email: { contains: 'events-api-test' } },
            select: { id: true }
        });
        const existingUserIds = existingUsers.map(u => u.id);
        
        await prisma.event.deleteMany({
            where: { name: { contains: 'Events API Test' } }
        });

        await prisma.program.deleteMany({
            where: { name: { contains: 'Events API Test' } }
        });
        
        await prisma.auditLog.deleteMany({
            where: { actorId: { in: existingUserIds } }
        });
        
        await prisma.participant.deleteMany({
            where: { id: { in: existingUserIds } }
        });

        // Create Admin
        const admin = await prisma.participant.create({
            data: { email: 'admin-events-api-test@example.com', name: 'Admin', sysadmin: true }
        });
        adminId = admin.id;

        // Create Lead
        const lead = await prisma.participant.create({
            data: { email: 'lead-events-api-test@example.com', name: 'Lead' }
        });
        leadId = lead.id;

        // Create Common User
        const commonUser = await prisma.participant.create({
            data: { email: 'common-events-api-test@example.com', name: 'Common' }
        });
        commonId = commonUser.id;

        // Create mock program
        const program = await prisma.program.create({
            data: { name: 'Events API Test Program', phase: 'PLANNING', leadMentorId: leadId }
        });
        targetProgramId = program.id;
    });

    afterAll(async () => {
        const existingUserIds = [adminId, leadId, commonId].filter(id => id !== undefined);

        await prisma.event.deleteMany({
            where: { programId: targetProgramId }
        });

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

    describe('POST /api/programs/[id]/events', () => {
        it('should return 401 Unauthorized without session', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);

             const req = new Request(`http://localhost:4000/api/programs/${targetProgramId}/events`, {
                 method: 'POST',
                 body: JSON.stringify({ name: 'New Test Event', start: new Date(), end: new Date() })
             });
             const res = await POST(req as any, createParams(targetProgramId) as any);
             expect(res.status).toBe(401);
        });

        it('should return 404 Not Found for non-existent program', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, sysadmin: true } });

             const req = new Request('http://localhost:4000/api/programs/999999/events', {
                 method: 'POST',
                 body: JSON.stringify({ name: 'New Test Event', start: new Date(), end: new Date() })
             });
             const res = await POST(req as any, createParams(999999) as any);
             expect(res.status).toBe(404);
        });

        it('should block common users from creating events', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const req = new Request(`http://localhost:4000/api/programs/${targetProgramId}/events`, {
                 method: 'POST',
                 body: JSON.stringify({ name: 'Hacked Event', start: new Date(), end: new Date() })
             });
             const res = await POST(req as any, createParams(targetProgramId) as any);
             expect(res.status).toBe(403);
             
             const data = await res.json();
             expect(data.error).toMatch(/Forbidden/);
        });

        it('should return 400 Bad Request if missing required fields', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: leadId } });

             const req = new Request(`http://localhost:4000/api/programs/${targetProgramId}/events`, {
                 method: 'POST',
                 body: JSON.stringify({ name: 'Incomplete Event' }) // missing start and end
             });
             const res = await POST(req as any, createParams(targetProgramId) as any);
             expect(res.status).toBe(400);
             
             const data = await res.json();
             expect(data.error).toBe('Event name, start, and end are required');
        });

        it('should allow the assigned lead mentor to create events', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: leadId } });

             const start = new Date(Date.now() + 86400000); // Tomorrow
             const end = new Date(start.getTime() + 3600000); // +1 hour

             const req = new Request(`http://localhost:4000/api/programs/${targetProgramId}/events`, {
                 method: 'POST',
                 body: JSON.stringify({ name: 'Mentor Events API Test', start, end, description: 'Created by Mentor' })
             });
             const res = await POST(req as any, createParams(targetProgramId) as any);
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.success).toBe(true);
             expect(data.event.name).toBe('Mentor Events API Test');
             expect(data.event.description).toBe('Created by Mentor');
             expect(new Date(data.event.start).getTime()).toBe(start.getTime());

             // Verify Audit
             const audits = await prisma.auditLog.findMany({
                 where: { actorId: leadId, action: 'CREATE', tableName: 'Event' }
             });
             expect(audits.length).toBeGreaterThan(0);
        });

        it('should allow admins to create events', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, sysadmin: true } });

             const start = new Date(Date.now() + 172800000); // Day after tomorrow
             const end = new Date(start.getTime() + 7200000); // +2 hours

             const req = new Request(`http://localhost:4000/api/programs/${targetProgramId}/events`, {
                 method: 'POST',
                 body: JSON.stringify({ name: 'Admin Events API Test', start, end })
             });
             const res = await POST(req as any, createParams(targetProgramId) as any);
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.success).toBe(true);
             expect(data.event.name).toBe('Admin Events API Test');
        });
    });
});
