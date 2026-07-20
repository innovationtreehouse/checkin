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
import { notifyNewProgramAnnounced } from '@/lib/notifications';
// Mock NextAuth
jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn(),
}));
jest.mock('@/lib/notifications', () => ({
    // The settings route's fire-without-await edge does
    // `notifyNewProgramAnnounced(...).catch(...)` — the mock must resolve so
    // `.catch` is defined (a bare jest.fn() returns undefined and throws).
    notifyNewProgramAnnounced: jest.fn().mockResolvedValue(undefined),
}));

const mockNotify = notifyNewProgramAnnounced as jest.Mock;
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
            data: { email: 'admin-settings-api-test@example.com', name: 'Admin', isSysadmin: true, household: { create: { name: "Test HH" } } }
        });
        adminId = admin.id;

        // Create Lead
        const lead = await prisma.person.create({
            data: { email: 'lead-settings-api-test@example.com', name: 'Lead', household: { create: { name: "Test HH" } } }
        });
        leadId = lead.id;

        // Create New Lead Candidate
        const newLead = await prisma.person.create({
            data: { email: 'newlead-settings-api-test@example.com', name: 'New Lead', household: { create: { name: "Test HH" } } }
        });
        newLeadId = newLead.id;

        // Create Common User
        const commonUser = await prisma.person.create({
            data: { email: 'common-settings-api-test@example.com', name: 'Common', household: { create: { name: "Test HH" } } }
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
        }
        // Covers targetProgramId plus the per-test programs the announce cases create.
        await prisma.program.deleteMany({
            where: { name: { contains: 'Settings API Test' } }
        });
        
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

        // #1153: the announce toggle is a lead-mentor setting — the existing gate
        // (line ~28-33) already allows lead mentors, no new role needed.
        it('should allow the lead mentor to flip announceOnOpen (persists round-trip)', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: leadId } });

             const onReq = new Request(`http://localhost:4000/api/programs/${targetProgramId}/settings`, {
                 method: 'PATCH',
                 body: JSON.stringify({ announceOnOpen: true })
             });
             const onRes = await PATCH(onReq as unknown as import("next/server").NextRequest, createParams(targetProgramId) as unknown as never);
             expect(onRes.status).toBe(200);
             const onData = await onRes.json();
             expect(onData.program.announceOnOpen).toBe(true);

             const persisted = await prisma.program.findUnique({ where: { id: targetProgramId } });
             expect(persisted?.announceOnOpen).toBe(true);

             const offReq = new Request(`http://localhost:4000/api/programs/${targetProgramId}/settings`, {
                 method: 'PATCH',
                 body: JSON.stringify({ announceOnOpen: false })
             });
             const offRes = await PATCH(offReq as unknown as import("next/server").NextRequest, createParams(targetProgramId) as unknown as never);
             expect(offRes.status).toBe(200);
             const offData = await offRes.json();
             expect(offData.program.announceOnOpen).toBe(false);
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

    // The settings PATCH is the lead-mentor edit surface and accepts phase /
    // enrollmentStatus / announceOnOpen, so it owns the same announce edge as
    // programs/[id] PATCH — see programAnnounceNotification.integration.test.ts.
    describe('announce trigger on PATCH /api/programs/[id]/settings', () => {
        const patchSettings = async (id: number, body: Record<string, unknown>) => {
            const req = new Request(`http://localhost:4000/api/programs/${id}/settings`, {
                method: 'PATCH',
                body: JSON.stringify(body)
            });
            return PATCH(req as unknown as import("next/server").NextRequest, createParams(id) as unknown as never);
        };

        beforeEach(() => {
            mockNotify.mockClear();
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });
        });

        it('fires once when the settings PATCH crosses INTO UPCOMING + OPEN (announceOnOpen: true)', async () => {
            const name = 'Settings API Test announce cross';
            const program = await prisma.program.create({
                data: { name, leadMentorId: leadId, phase: 'PLANNING', enrollmentStatus: 'CLOSED', announceOnOpen: true }
            });

            const res = await patchSettings(program.id, { phase: 'UPCOMING', enrollmentStatus: 'OPEN' });
            expect(res.status).toBe(200);
            expect(mockNotify).toHaveBeenCalledTimes(1);
            expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ name }));
        });

        it('does NOT fire on the same crossing with announceOnOpen at its false default', async () => {
            const program = await prisma.program.create({
                data: { name: 'Settings API Test announce default-off', leadMentorId: leadId, phase: 'PLANNING', enrollmentStatus: 'CLOSED' }
            });

            const res = await patchSettings(program.id, { phase: 'UPCOMING', enrollmentStatus: 'OPEN' });
            expect(res.status).toBe(200);
            expect(mockNotify).not.toHaveBeenCalled();
        });

        it('does NOT re-fire on a later edit while already UPCOMING + OPEN', async () => {
            const program = await prisma.program.create({
                data: { name: 'Settings API Test announce already', leadMentorId: leadId, phase: 'UPCOMING', enrollmentStatus: 'OPEN', announceOnOpen: true }
            });

            const res = await patchSettings(program.id, { name: 'Settings API Test announce already renamed' });
            expect(res.status).toBe(200);
            expect(mockNotify).not.toHaveBeenCalled();
        });

        it('does NOT fire when only phase flips to UPCOMING (enrollment still CLOSED)', async () => {
            const program = await prisma.program.create({
                data: { name: 'Settings API Test announce phaseonly', leadMentorId: leadId, phase: 'PLANNING', enrollmentStatus: 'CLOSED', announceOnOpen: true }
            });

            const res = await patchSettings(program.id, { phase: 'UPCOMING' });
            expect(res.status).toBe(200);
            expect(mockNotify).not.toHaveBeenCalled();
        });

        it('does NOT fire when only enrollment flips to OPEN (phase still PLANNING)', async () => {
            const program = await prisma.program.create({
                data: { name: 'Settings API Test announce enrollonly', leadMentorId: leadId, phase: 'PLANNING', enrollmentStatus: 'CLOSED', announceOnOpen: true }
            });

            const res = await patchSettings(program.id, { enrollmentStatus: 'OPEN' });
            expect(res.status).toBe(200);
            expect(mockNotify).not.toHaveBeenCalled();
        });
    });
});
