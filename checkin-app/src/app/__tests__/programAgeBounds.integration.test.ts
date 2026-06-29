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
import { getServerSession } from 'next-auth/next';
// Mock NextAuth
jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn(),
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
    let exactlyMinUserId: number;
    let exactlyMaxUserId: number;
    let turns14TomorrowUserId: number;
    let turned19YesterdayUserId: number;
    let testProgramId: number;

    beforeAll(async () => {
        // Calculate Birthdates dynamically relative to execution time
        const now = new Date();
        const dob16 = new Date(now.getFullYear() - 16, now.getMonth(), now.getDate());
        const dob12 = new Date(now.getFullYear() - 12, now.getMonth(), now.getDate());
        const dob20 = new Date(now.getFullYear() - 20, now.getMonth(), now.getDate());
        // Exact boundaries for program [minAge=14, maxAge=18].
        // Birthday is today => exactly N years old today (eligible at both ends).
        const dobExactly14 = new Date(now.getFullYear() - 14, now.getMonth(), now.getDate());
        const dobExactly18 = new Date(now.getFullYear() - 18, now.getMonth(), now.getDate());
        // Birthday tomorrow, born 14 years ago => still 13 today (under).
        const dobTurns14Tomorrow = new Date(now.getFullYear() - 14, now.getMonth(), now.getDate() + 1);
        // Birthday yesterday, born 19 years ago => turned 19 already (over).
        const dobTurned19Yesterday = new Date(now.getFullYear() - 19, now.getMonth(), now.getDate() - 1);

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
            data: { email: 'admin-age-test@example.com', name: 'Admin Age Test', sysadmin: true, household: { create: {} } }
        });
        testAdminId = admin.id;

        const pValid = await prisma.participant.create({
            data: { email: 'valid-age-test@example.com', name: 'Valid Age Test', dateOfBirth: dob16, household: { create: {} } }
        });
        validUserId = pValid.id;

        const pUnder = await prisma.participant.create({
            data: { email: 'underage-test@example.com', name: 'Underage Test', dateOfBirth: dob12, household: { create: {} } }
        });
        underageUserId = pUnder.id;

        const pOver = await prisma.participant.create({
            data: { email: 'overage-test@example.com', name: 'Overage Test', dateOfBirth: dob20, household: { create: {} } }
        });
        overageUserId = pOver.id;

        const pNoDob = await prisma.participant.create({
            data: { email: 'no-dob-test@example.com', name: 'No DOB Test', household: { create: {} } }
        });
        noDobUserId = pNoDob.id;

        const pExactlyMin = await prisma.participant.create({
            data: { email: 'exactly-min-age-test@example.com', name: 'Exactly Min Age Test', dateOfBirth: dobExactly14, household: { create: {} } }
        });
        exactlyMinUserId = pExactlyMin.id;

        const pExactlyMax = await prisma.participant.create({
            data: { email: 'exactly-max-age-test@example.com', name: 'Exactly Max Age Test', dateOfBirth: dobExactly18, household: { create: {} } }
        });
        exactlyMaxUserId = pExactlyMax.id;

        const pTurns14Tomorrow = await prisma.participant.create({
            data: { email: 'turns-14-tomorrow-age-test@example.com', name: 'Turns 14 Tomorrow Test', dateOfBirth: dobTurns14Tomorrow, household: { create: {} } }
        });
        turns14TomorrowUserId = pTurns14Tomorrow.id;

        const pTurned19Yesterday = await prisma.participant.create({
            data: { email: 'turned-19-yesterday-age-test@example.com', name: 'Turned 19 Yesterday Test', dateOfBirth: dobTurned19Yesterday, household: { create: {} } }
        });
        turned19YesterdayUserId = pTurned19Yesterday.id;

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

        const actorIds = [testAdminId, validUserId, underageUserId, overageUserId, noDobUserId, exactlyMinUserId, exactlyMaxUserId, turns14TomorrowUserId, turned19YesterdayUserId].filter(id => id !== undefined);
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

    it('should allow self-enrollment for a participant who is EXACTLY minAge today (birthday today)', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({
            user: { id: exactlyMinUserId, sysadmin: false, boardMember: false }
        });

        const req = new Request(`http://localhost:4000/api/programs/${testProgramId}/participants`, {
            method: 'POST',
            body: JSON.stringify({ participantId: exactlyMinUserId })
        });

        const res = await enrollParticipant(req, { params: Promise.resolve({ id: testProgramId.toString() }) });
        expect(res.status).toBe(200);

        const data = await res.json();
        expect(data.success).toBe(true);
    });

    it('should allow self-enrollment for a participant who is EXACTLY maxAge', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({
            user: { id: exactlyMaxUserId, sysadmin: false, boardMember: false }
        });

        const req = new Request(`http://localhost:4000/api/programs/${testProgramId}/participants`, {
            method: 'POST',
            body: JSON.stringify({ participantId: exactlyMaxUserId })
        });

        const res = await enrollParticipant(req, { params: Promise.resolve({ id: testProgramId.toString() }) });
        expect(res.status).toBe(200);

        const data = await res.json();
        expect(data.success).toBe(true);
    });

    it('should block a participant who only turns minAge tomorrow (still under today)', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({
            user: { id: turns14TomorrowUserId, sysadmin: false, boardMember: false }
        });

        const req = new Request(`http://localhost:4000/api/programs/${testProgramId}/participants`, {
            method: 'POST',
            body: JSON.stringify({ participantId: turns14TomorrowUserId })
        });

        const res = await enrollParticipant(req, { params: Promise.resolve({ id: testProgramId.toString() }) });
        expect(res.status).toBe(400);

        const data = await res.json();
        expect(data.error).toContain('least 14 years old');
        expect(data.requiresOverride).toBe(true);
    });

    it('should block a participant who turned maxAge+1 yesterday (now over)', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({
            user: { id: turned19YesterdayUserId, sysadmin: false, boardMember: false }
        });

        const req = new Request(`http://localhost:4000/api/programs/${testProgramId}/participants`, {
            method: 'POST',
            body: JSON.stringify({ participantId: turned19YesterdayUserId })
        });

        const res = await enrollParticipant(req, { params: Promise.resolve({ id: testProgramId.toString() }) });
        expect(res.status).toBe(400);

        const data = await res.json();
        expect(data.error).toContain('maximum age is 18 years old');
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
