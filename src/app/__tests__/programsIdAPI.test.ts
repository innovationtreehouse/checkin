/**
 * @jest-environment node
 */
/**
 * Integration Tests for Individual Program API
 * Tests GET and PATCH /api/programs/[id] for viewing and updating a specific program
 */

import { GET, PATCH } from '@/app/api/programs/[id]/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';

// Mock NextAuth
jest.mock('next-auth', () => ({
    getServerSession: jest.fn()
}));
jest.mock('@/app/api/auth/[...nextauth]/route', () => ({
    authOptions: {}
}));

describe('Individual Program API Integration Tests', () => {
    let adminId: number;
    let leadId: number;
    let commonId: number;
    let memberId: number;
    let publicProgramId: number;
    let memberOnlyProgramId: number;

    beforeAll(async () => {
        // Clean up any leaked state
        const existingUsers = await prisma.participant.findMany({
            where: { email: { contains: 'prog-id-api-test' } },
            select: { id: true, memberships: true }
        });
        const existingUserIds = existingUsers.map(u => u.id);
        const existingMembershipIds = existingUsers.flatMap(u => u.memberships).map(m => m.id);
        
        await prisma.membership.deleteMany({
            where: { id: { in: existingMembershipIds } }
        });

        await prisma.program.deleteMany({
            where: { name: { contains: 'Prog ID API Test' } }
        });
        
        await prisma.auditLog.deleteMany({
            where: { actorId: { in: existingUserIds } }
        });
        
        await prisma.participant.deleteMany({
            where: { id: { in: existingUserIds } }
        });

        // Create Admin
        const admin = await prisma.participant.create({
            data: { email: 'admin-prog-id-api-test@example.com', name: 'Admin', sysadmin: true }
        });
        adminId = admin.id;

        // Create Lead
        const lead = await prisma.participant.create({
            data: { email: 'lead-prog-id-api-test@example.com', name: 'Lead' }
        });
        leadId = lead.id;

        // Create Common User (no membership)
        const commonUser = await prisma.participant.create({
            data: { email: 'common-prog-id-api-test@example.com', name: 'Common' }
        });
        commonId = commonUser.id;

        // Create Member User (active membership)
        const memberUser = await prisma.participant.create({
            data: { 
                email: 'member-prog-id-api-test@example.com', 
                name: 'Member',
                memberships: {
                    create: {
                        type: 'HOUSEHOLD',
                        active: true,
                        since: new Date()
                    }
                }
            }
        });
        memberId = memberUser.id;

        // Create mock programs
        const publicProgram = await prisma.program.create({
            data: { name: 'Public Prog ID API Test', phase: 'RUNNING', memberOnly: false, leadMentorId: leadId }
        });
        publicProgramId = publicProgram.id;

        const memberOnlyProgram = await prisma.program.create({
            data: { name: 'Member Only Prog ID API Test', phase: 'RUNNING', memberOnly: true, leadMentorId: leadId }
        });
        memberOnlyProgramId = memberOnlyProgram.id;
    });

    afterAll(async () => {
        const existingUserIds = [adminId, leadId, commonId, memberId];

        if (memberId) {
            await prisma.membership.deleteMany({
                where: { volunteerId: memberId }
            });
        }

        const validProgramIds = [publicProgramId, memberOnlyProgramId].filter(id => id !== undefined);
        if (validProgramIds.length > 0) {
            await prisma.program.deleteMany({
                where: { id: { in: validProgramIds } }
            });
        }
        
        await prisma.auditLog.deleteMany({
            where: { actorId: { in: existingUserIds } }
        });
        
        await prisma.participant.deleteMany({
            where: { id: { in: existingUserIds } }
        });
    });

    // Helper function to mock Next.js App Router params
    const createParams = (id: number) => ({ params: Promise.resolve({ id: id.toString() }) });

    describe('GET /api/programs/[id]', () => {
        it('should return 401 Unauthorized without session', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);

             const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, { method: 'GET' });
             const res = await GET(req as any, createParams(publicProgramId) as any);
             expect(res.status).toBe(401);
        });

        it('should return 404 Not Found for invalid program ID', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId } });

             const req = new Request('http://localhost:4000/api/programs/999999', { method: 'GET' });
             const res = await GET(req as any, createParams(999999) as any);
             expect(res.status).toBe(404);
        });

        it('should allow common users to view public programs', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, { method: 'GET' });
             const res = await GET(req as any, createParams(publicProgramId) as any);
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.name).toBe('Public Prog ID API Test');
             expect(data.leadMentor.id).toBe(leadId);
        });

        it('should block common users from viewing member-only programs', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const req = new Request(`http://localhost:4000/api/programs/${memberOnlyProgramId}`, { method: 'GET' });
             const res = await GET(req as any, createParams(memberOnlyProgramId) as any);
             expect(res.status).toBe(403);
             
             const data = await res.json();
             expect(data.error).toMatch(/Forbidden/);
        });

        it('should allow active members to view member-only programs', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: memberId } });

             const req = new Request(`http://localhost:4000/api/programs/${memberOnlyProgramId}`, { method: 'GET' });
             const res = await GET(req as any, createParams(memberOnlyProgramId) as any);
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.name).toBe('Member Only Prog ID API Test');
        });

        it('should allow admins to view member-only programs without active membership', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, sysadmin: true } });

             const req = new Request(`http://localhost:4000/api/programs/${memberOnlyProgramId}`, { method: 'GET' });
             const res = await GET(req as any, createParams(memberOnlyProgramId) as any);
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.name).toBe('Member Only Prog ID API Test');
        });
    });

    describe('PATCH /api/programs/[id]', () => {
        it('should return 401 Unauthorized without session', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);

             const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, {
                 method: 'PATCH',
                 body: JSON.stringify({ name: 'Hacked' })
             });
             const res = await PATCH(req as any, createParams(publicProgramId) as any);
             expect(res.status).toBe(401);
        });

        it('should block common users from updating a program', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, {
                 method: 'PATCH',
                 body: JSON.stringify({ name: 'Hacked' })
             });
             const res = await PATCH(req as any, createParams(publicProgramId) as any);
             expect(res.status).toBe(403);
        });

        it('should allow the assigned lead mentor to update a program', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: leadId } });

             const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, {
                 method: 'PATCH',
                 body: JSON.stringify({ maxParticipants: 50 })
             });
             const res = await PATCH(req as any, createParams(publicProgramId) as any);
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.program.maxParticipants).toBe(50);
        });

        it('should allow admins to update a program', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, sysadmin: true } });

             const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, {
                 method: 'PATCH',
                 body: JSON.stringify({ phase: 'FINISHED' })
             });
             const res = await PATCH(req as any, createParams(publicProgramId) as any);
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.program.phase).toBe('FINISHED');
        });
    });
});
