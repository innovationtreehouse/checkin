/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @jest-environment node
 */
/**
 * Integration Tests for Programs API
 * Tests GET and POST /api/programs for fetching programs and creating new ones.
 */

import { GET, POST } from '@/app/api/programs/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
// Mock NextAuth
jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn(),
}));
// Mock Notifications
jest.mock('@/lib/notifications', () => ({
    sendNotification: jest.fn()
}));

describe('Programs API Integration Tests', () => {
    let adminId: number;
    let commonId: number;
    let leadId: number;

    beforeAll(async () => {
        // Clean up any leaked state
        const existingUsers = await prisma.participant.findMany({
            where: { email: { contains: 'programs-api-test' } },
            select: { id: true }
        });
        const existingUserIds = existingUsers.map(u => u.id);
        
        await prisma.program.deleteMany({
            where: { name: { contains: 'API Test Program' } }
        });
        
        await prisma.auditLog.deleteMany({
            where: { actorId: { in: existingUserIds } }
        });
        
        await prisma.participant.deleteMany({
            where: { id: { in: existingUserIds } }
        });

        // Create Admin
        const admin = await prisma.participant.create({
            data: { email: 'admin-programs-api-test@example.com', name: 'Admin', sysadmin: true }
        });
        adminId = admin.id;

        // Create Lead
        const lead = await prisma.participant.create({
            data: { email: 'lead-programs-api-test@example.com', name: 'Lead' }
        });
        leadId = lead.id;

        // Create Common User
        const commonUser = await prisma.participant.create({
            data: { email: 'common-programs-api-test@example.com', name: 'Common' }
        });
        commonId = commonUser.id;

        // Create mock programs
        await prisma.program.createMany({
            data: [
                { name: 'Public API Test Program', phase: 'RUNNING', memberOnly: false, minAge: 10, maxAge: 18 },
                { name: 'Draft API Test Program', phase: 'PLANNING', memberOnly: false, leadMentorId: leadId },
                { name: 'Member Only API Test Program', phase: 'RUNNING', memberOnly: true }
            ]
        });
    });

    afterAll(async () => {
        const existingUserIds = [adminId, leadId, commonId];

        await prisma.program.deleteMany({
            where: { name: { contains: 'API Test Program' } }
        });
        
        await prisma.auditLog.deleteMany({
            where: { actorId: { in: existingUserIds } }
        });
        
        await prisma.participant.deleteMany({
            where: { id: { in: existingUserIds } }
        });
    });

    describe('GET /api/programs', () => {
        it('should return only public, active programs for unauthenticated users', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);

             const req = new Request('http://localhost:4000/api/programs', { method: 'GET' });
             const res = await GET(req as any);
             expect(res.status).toBe(200);

             const programs = await res.json();
             
             const publicActive = programs.find((p: any) => p.name === 'Public API Test Program');
             const draft = programs.find((p: any) => p.name === 'Draft API Test Program');
             const memberOnly = programs.find((p: any) => p.name === 'Member Only API Test Program');

             expect(publicActive).toBeDefined();
             expect(draft).toBeUndefined(); // Filtered because it is in PLANNING
             expect(memberOnly).toBeUndefined(); // Filtered because memberOnly is true
        });

        it('should return drafts if the authenticated user is the lead mentor', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: leadId } });

             const req = new Request('http://localhost:4000/api/programs', { method: 'GET' });
             const res = await GET(req as any);
             expect(res.status).toBe(200);

             const programs = await res.json();
             const draft = programs.find((p: any) => p.name === 'Draft API Test Program');

             expect(draft).toBeDefined(); // Revealed because the user is the lead
        });

        it('should return all programs including drafts and member-only for admins', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, sysadmin: true } });

             const req = new Request('http://localhost:4000/api/programs', { method: 'GET' });
             const res = await GET(req as any);
             expect(res.status).toBe(200);

             const programs = await res.json();
             const draft = programs.find((p: any) => p.name === 'Draft API Test Program');
             const memberOnly = programs.find((p: any) => p.name === 'Member Only API Test Program');

             expect(draft).toBeDefined(); // Revealed because admin
             expect(memberOnly).toBeDefined(); // Revealed because admin
        });
    });

    describe('POST /api/programs', () => {
        it('should block non-admins from creating a program', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const req = new Request('http://localhost:4000/api/programs', {
                 method: 'POST',
                 body: JSON.stringify({ name: 'New API Test Program' })
             });
             const res = await POST(req as any);
             expect(res.status).toBe(403);
             const data = await res.json();
             expect(data.error).toMatch(/Forbidden/);
        });

        it('should reject when missing required program name', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, sysadmin: true } });

             const req = new Request('http://localhost:4000/api/programs', {
                 method: 'POST',
                 body: JSON.stringify({ leadMentorId: leadId })
             });
             const res = await POST(req as any);
             expect(res.status).toBe(400);
        });

        it('should reject when missing required leadMentorId', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, sysadmin: true } });

             const req = new Request('http://localhost:4000/api/programs', {
                 method: 'POST',
                 body: JSON.stringify({ name: 'Created API Test Program Missing Mentor', minAge: 12, maxAge: 17 })
             });
             const res = await POST(req as any);
             expect(res.status).toBe(400);
        });

        it('should allow admins to create a program', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, sysadmin: true } });

             const req = new Request('http://localhost:4000/api/programs', {
                 method: 'POST',
                 body: JSON.stringify({ name: 'Created API Test Program', leadMentorId: leadId, minAge: 12, maxAge: 17 })
             });
             const res = await POST(req as any);
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.success).toBe(true);
             expect(data.program.name).toBe('Created API Test Program');
             expect(data.program.leadMentorId).toBe(leadId);
             expect(data.program.minAge).toBe(12);
             expect(data.program.maxAge).toBe(17);
        });
    });
});
