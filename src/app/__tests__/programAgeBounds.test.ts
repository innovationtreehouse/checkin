/**
 * @jest-environment node
 */
/**
 * Integration Test for Program Age Boundaries
 * Ensures that the system correctly enforces minAge and maxAge bounds during self-enrollment blocks,
 * while allowing Administrators to override the blocks manually.
 */

import { POST as enrollParticipant } from '@/app/api/programs/[id]/participants/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';

// Mock NextAuth
jest.mock('next-auth', () => ({
    getServerSession: jest.fn(),
}));

jest.mock('@/app/api/auth/[...nextauth]/route', () => ({
    authOptions: {}
}));

// Mock Notifications to avoid external calls
jest.mock('@/lib/notifications', () => ({
    sendNotification: jest.fn()
}));

describe('Program Age Bounds Integration Tests', () => {
    let testAdminId: number;
    let validUserId: number;
    let underageUserId: number;
    let overageUserId: number;
    let noDobUserId: number;
    let testProgramId: number;

    beforeAll(async () => {
        // Calculate Birthdates dynamically relative to execution time
        const now = new Date();
        const dob16 = new Date(now.getFullYear() - 16, now.getMonth(), now.getDate());
        const dob12 = new Date(now.getFullYear() - 12, now.getMonth(), now.getDate());
        const dob20 = new Date(now.getFullYear() - 20, now.getMonth(), now.getDate());

        // Clean up any leaked state from previous runs
        await prisma.auditLog.deleteMany({});
        await prisma.programParticipant.deleteMany({});
        await prisma.programVolunteer.deleteMany({});
        await prisma.event.deleteMany({});
        await prisma.program.deleteMany({});
        await prisma.participant.deleteMany({
            where: { email: { contains: 'age-test' } }
        });

        // Setup mock database records
        const admin = await prisma.participant.create({
            data: { email: 'admin-age-test@example.com', name: 'Admin Age Test', sysadmin: true }
        });
        testAdminId = admin.id;

        const pValid = await prisma.participant.create({
            data: { email: 'valid-age-test@example.com', name: 'Valid Age Test', dob: dob16 }
        });
        validUserId = pValid.id;

        const pUnder = await prisma.participant.create({
            data: { email: 'underage-test@example.com', name: 'Underage Test', dob: dob12 }
        });
        underageUserId = pUnder.id;

        const pOver = await prisma.participant.create({
            data: { email: 'overage-test@example.com', name: 'Overage Test', dob: dob20 }
        });
        overageUserId = pOver.id;

        const pNoDob = await prisma.participant.create({
            data: { email: 'no-dob-test@example.com', name: 'No DOB Test' }
        });
        noDobUserId = pNoDob.id;

        const program = await prisma.program.create({
            data: {
                name: 'Age Bounds Integration Test Program',
                minAge: 14,
                maxAge: 18,
                begin: new Date(),
                phase: 'UPCOMING',
                enrollmentStatus: 'OPEN'
            }
        });
        testProgramId = program.id;
    });

    afterAll(async () => {
        // Clean up
        if (testProgramId !== undefined) {
            await prisma.programParticipant.deleteMany({ where: { programId: testProgramId } });
            await prisma.program.deleteMany({ where: { id: testProgramId } });
        }

        const actorIds = [testAdminId, validUserId, underageUserId, overageUserId, noDobUserId].filter(id => id !== undefined);
        if (actorIds.length > 0) {
            await prisma.auditLog.deleteMany({
                where: { actorId: { in: actorIds } }
            });
            await prisma.participant.deleteMany({
                where: { id: { in: actorIds } }
            });
        }
    });

    afterEach(async () => {
        // Ensure enrollments are wiped clean after each test to prevent ID conflicts
        await prisma.programParticipant.deleteMany({ where: { programId: testProgramId } });
    });

    it('should allow self-enrollment for a participant within the valid age range', async () => {
        // Mock session to standard valid user
        (getServerSession as jest.Mock).mockResolvedValue({
            user: { id: validUserId, sysadmin: false, boardMember: false }
        });

        const req = new Request(`http://localhost:4000/api/programs/${testProgramId}/participants`, {
            method: 'POST',
            body: JSON.stringify({ participantId: validUserId })
        });

        const res = await enrollParticipant(req, { params: Promise.resolve({ id: testProgramId.toString() }) });
        expect(res.status).toBe(200);

        const data = await res.json();
        expect(data.success).toBe(true);
    });

    it('should block self-enrollment for an underage participant', async () => {
        // Mock session to underage user
        (getServerSession as jest.Mock).mockResolvedValue({
            user: { id: underageUserId, sysadmin: false, boardMember: false }
        });

        const req = new Request(`http://localhost:4000/api/programs/${testProgramId}/participants`, {
            method: 'POST',
            body: JSON.stringify({ participantId: underageUserId })
        });

        const res = await enrollParticipant(req, { params: Promise.resolve({ id: testProgramId.toString() }) });
        expect(res.status).toBe(400);

        const data = await res.json();
        expect(data.error).toContain('least 14 years old');
        expect(data.requiresOverride).toBe(true);
    });

    it('should block self-enrollment for an overage participant', async () => {
        // Mock session to overage user
        (getServerSession as jest.Mock).mockResolvedValue({
            user: { id: overageUserId, sysadmin: false, boardMember: false }
        });

        const req = new Request(`http://localhost:4000/api/programs/${testProgramId}/participants`, {
            method: 'POST',
            body: JSON.stringify({ participantId: overageUserId })
        });

        const res = await enrollParticipant(req, { params: Promise.resolve({ id: testProgramId.toString() }) });
        expect(res.status).toBe(400);

        const data = await res.json();
        expect(data.error).toContain('maximum age is 18 years old');
        expect(data.requiresOverride).toBe(true);
    });

    it('should block self-enrollment for a participant missing Date of Birth', async () => {
        // Mock session to no-dob user
        (getServerSession as jest.Mock).mockResolvedValue({
            user: { id: noDobUserId, sysadmin: false, boardMember: false }
        });

        const req = new Request(`http://localhost:4000/api/programs/${testProgramId}/participants`, {
            method: 'POST',
            body: JSON.stringify({ participantId: noDobUserId })
        });

        const res = await enrollParticipant(req, { params: Promise.resolve({ id: testProgramId.toString() }) });
        expect(res.status).toBe(400);

        const data = await res.json();
        expect(data.error).toBe('Participant Date of Birth is missing.');
        expect(data.requiresOverride).toBe(true);
    });

    it('should allow an Administrator to override Age bounds and enroll an underage participant', async () => {
        // Mock session to sysadmin user
        (getServerSession as jest.Mock).mockResolvedValue({
            user: { id: testAdminId, sysadmin: true, boardMember: false }
        });

        const req = new Request(`http://localhost:4000/api/programs/${testProgramId}/participants`, {
            method: 'POST',
            body: JSON.stringify({ participantId: underageUserId, override: true })
        });

        const res = await enrollParticipant(req, { params: Promise.resolve({ id: testProgramId.toString() }) });
        expect(res.status).toBe(200);

        const data = await res.json();
        expect(data.success).toBe(true);
    });
});
