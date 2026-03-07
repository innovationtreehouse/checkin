/**
 * @jest-environment node
 */
/**
 * Integration Tests for Program Participants API
 * Tests POST and DELETE /api/programs/[id]/participants for enrollments
 */

import { POST, DELETE } from '@/app/api/programs/[id]/participants/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';

// Mock NextAuth
jest.mock('next-auth', () => ({
    getServerSession: jest.fn()
}));
jest.mock('@/app/api/auth/[...nextauth]/route', () => ({
    authOptions: {}
}));
// Mock Notifications
jest.mock('@/lib/notifications', () => ({
    sendNotification: jest.fn()
}));

describe('Program Participants API Integration Tests', () => {
    let adminId: number;
    let leadId: number;
    let commonId: number;
    let otherId: number;
    
    let standardProgramId: number;
    let fullProgramId: number;
    let exactAgeProgramId: number;

    beforeAll(async () => {
        // Clean up any leaked state
        const existingUsers = await prisma.participant.findMany({
            where: { email: { contains: 'partic-api-test' } },
            select: { id: true }
        });
        const existingUserIds = existingUsers.map(u => u.id);
        
        await prisma.programParticipant.deleteMany({
            where: { participantId: { in: existingUserIds } }
        });

        await prisma.program.deleteMany({
            where: { name: { contains: 'Partic API Test' } }
        });
        
        await prisma.auditLog.deleteMany({
            where: { actorId: { in: existingUserIds } }
        });
        
        await prisma.participant.deleteMany({
            where: { id: { in: existingUserIds } }
        });

        // Create Admin
        const admin = await prisma.participant.create({
            data: { email: 'admin-partic-api-test@example.com', name: 'Admin', sysadmin: true }
        });
        adminId = admin.id;

        // Create Lead
        const lead = await prisma.participant.create({
            data: { email: 'lead-partic-api-test@example.com', name: 'Lead' }
        });
        leadId = lead.id;

        // Create Common User (25 years old)
        const commonUser = await prisma.participant.create({
            data: { 
                email: 'common-partic-api-test@example.com', 
                name: 'Common',
                dob: new Date(Date.now() - (25 * 31556952000))
            }
        });
        commonId = commonUser.id;

        // Create Other User (underage: 10 years old)
        const otherUser = await prisma.participant.create({
            data: { 
                email: 'other-partic-api-test@example.com', 
                name: 'Other Underage',
                dob: new Date(Date.now() - (10 * 31556952000))
            }
        });
        otherId = otherUser.id;

        // Create mock programs
        const standardProgram = await prisma.program.create({
            data: { name: 'Standard Partic API Test', phase: 'RUNNING', leadMentorId: leadId }
        });
        standardProgramId = standardProgram.id;

        // Create a capped program and pre-fill it to its capacity (1 participant)
        const fullProgram = await prisma.program.create({
            data: { 
                name: 'Full Partic API Test', 
                phase: 'RUNNING', 
                maxParticipants: 1,
                participants: {
                    create: { participantId: otherId }
                }
            }
        });
        fullProgramId = fullProgram.id;

        const exactAgeProgram = await prisma.program.create({
            data: { name: 'Age Restricted Partic API Test', phase: 'RUNNING', minAge: 18, maxAge: 21 }
        });
        exactAgeProgramId = exactAgeProgram.id;
    });

    afterAll(async () => {
        const existingUserIds = [adminId, leadId, commonId, otherId].filter(id => id !== undefined);
        const validProgramIds = [standardProgramId, fullProgramId, exactAgeProgramId].filter(id => id !== undefined);

        if (existingUserIds.length > 0) {
            await prisma.programParticipant.deleteMany({
                where: { participantId: { in: existingUserIds } }
            });
        }

        if (validProgramIds.length > 0) {
            await prisma.program.deleteMany({
                where: { id: { in: validProgramIds } }
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

    describe('POST /api/programs/[id]/participants', () => {
        it('should return 401 Unauthorized without session', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);

             const req = new Request(`http://localhost:4000/api/programs/${standardProgramId}/participants`, {
                 method: 'POST',
                 body: JSON.stringify({ participantId: commonId })
             });
             const res = await POST(req as any, createParams(standardProgramId) as any);
             expect(res.status).toBe(401);
        });

        it('should block a common user from enrolling someone else', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const req = new Request(`http://localhost:4000/api/programs/${standardProgramId}/participants`, {
                 method: 'POST',
                 body: JSON.stringify({ participantId: otherId }) // common trying to enroll other
             });
             const res = await POST(req as any, createParams(standardProgramId) as any);
             expect(res.status).toBe(403);
             
             const data = await res.json();
             expect(data.error).toMatch(/Forbidden/);
        });

        it('should allow a common user to self-enroll into an unrestricted program', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const req = new Request(`http://localhost:4000/api/programs/${standardProgramId}/participants`, {
                 method: 'POST',
                 body: JSON.stringify({ participantId: commonId }) // self-enrollment
             });
             const res = await POST(req as any, createParams(standardProgramId) as any);
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.success).toBe(true);
             expect(data.enrollment.participantId).toBe(commonId);
        });

        it('should block self-enrollment if the program is at full capacity', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const req = new Request(`http://localhost:4000/api/programs/${fullProgramId}/participants`, {
                 method: 'POST',
                 body: JSON.stringify({ participantId: commonId })
             });
             const res = await POST(req as any, createParams(fullProgramId) as any);
             expect(res.status).toBe(400); // 400 Bad Request
             
             const data = await res.json();
             expect(data.error).toMatch(/maximum capacity/);
             expect(data.requiresOverride).toBe(true);
        });

        it('should block self-enrollment if out of age constraints', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: otherId } }); // other is 10 years old

             const req = new Request(`http://localhost:4000/api/programs/${exactAgeProgramId}/participants`, {
                 method: 'POST',
                 body: JSON.stringify({ participantId: otherId })
             });
             const res = await POST(req as any, createParams(exactAgeProgramId) as any);
             expect(res.status).toBe(400);
             
             const data = await res.json();
             expect(data.error).toMatch(/at least 18/);
             expect(data.requiresOverride).toBe(true);
        });

        it('should allow admins to bypass age constraints using override', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, sysadmin: true } });

             const req = new Request(`http://localhost:4000/api/programs/${exactAgeProgramId}/participants`, {
                 method: 'POST',
                 body: JSON.stringify({ participantId: otherId, override: true }) // ignoring age rules
             });
             const res = await POST(req as any, createParams(exactAgeProgramId) as any);
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.success).toBe(true);
        });
    });

    describe('DELETE /api/programs/[id]/participants', () => {
        it('should return 401 Unauthorized without session', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);

             const req = new Request(`http://localhost:4000/api/programs/${standardProgramId}/participants`, {
                 method: 'DELETE',
                 body: JSON.stringify({ participantId: commonId })
             });
             const res = await DELETE(req as any, createParams(standardProgramId) as any);
             expect(res.status).toBe(401);
        });

        it('should block a common user from un-enrolling someone else', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const req = new Request(`http://localhost:4000/api/programs/${exactAgeProgramId}/participants`, {
                 method: 'DELETE',
                 body: JSON.stringify({ participantId: otherId })
             });
             const res = await DELETE(req as any, createParams(exactAgeProgramId) as any);
             expect(res.status).toBe(403);
             
             const data = await res.json();
             expect(data.error).toMatch(/Forbidden/);
        });

        it('should allow the program lead to un-enroll a participant', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: leadId } });

             const req = new Request(`http://localhost:4000/api/programs/${standardProgramId}/participants`, {
                 method: 'DELETE',
                 body: JSON.stringify({ participantId: commonId }) // assigned lead removing common from standardProgram
             });
             const res = await DELETE(req as any, createParams(standardProgramId) as any);
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.success).toBe(true);
             expect(data.enrollment.participantId).toBe(commonId);
        });
        
        it('should allow a common user to drop out of their own program', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: otherId } });

             const req = new Request(`http://localhost:4000/api/programs/${fullProgramId}/participants`, {
                 method: 'DELETE',
                 body: JSON.stringify({ participantId: otherId }) // self-removal
             });
             const res = await DELETE(req as any, createParams(fullProgramId) as any);
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.success).toBe(true);
        });
    });
});
