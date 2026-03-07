/**
 * @jest-environment node
 */
/**
 * Integration Tests for Event Attendance API
 * Tests POST /api/events/[id]/attendance for validating participant attendance
 */

import { POST } from '@/app/api/events/[id]/attendance/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';

// Mock NextAuth
jest.mock('next-auth', () => ({
    getServerSession: jest.fn(),
}));

jest.mock('@/app/api/auth/[...nextauth]/route', () => ({
    authOptions: {}
}));

describe('Event Attendance API Integration Tests', () => {
    let testAdminId: number;
    let testUserId: number;
    let testLeadMentorId: number;
    let testProgramId: number;
    let testEventId: number;
    let testParticipant1Id: number;
    let testParticipant2Id: number;

    beforeAll(async () => {
        // Clean up any leaked state
        await prisma.visit.deleteMany({
            where: { participant: { email: { contains: 'event-attendance-test' } } }
        });
        await prisma.event.deleteMany({
            where: { name: 'Attendance Test Event' }
        });
        await prisma.program.deleteMany({
            where: { name: 'Attendance Test Program' }
        });
        await prisma.participant.deleteMany({
            where: { email: { contains: 'event-attendance-test' } }
        });

        // Setup mock database records
        const admin = await prisma.participant.create({
            data: { email: 'admin-event-attendance-test@example.com', name: 'Admin Att Test', sysadmin: true }
        });
        testAdminId = admin.id;

        const user = await prisma.participant.create({
            data: { email: 'user-event-attendance-test@example.com', name: 'User Att Test' }
        });
        testUserId = user.id;

        const mentor = await prisma.participant.create({
            data: { email: 'mentor-event-attendance-test@example.com', name: 'Mentor Att Test' }
        });
        testLeadMentorId = mentor.id;

        const participant1 = await prisma.participant.create({
            data: { email: 'p1-event-attendance-test@example.com', name: 'P1 Att Test' }
        });
        testParticipant1Id = participant1.id;

        const participant2 = await prisma.participant.create({
            data: { email: 'p2-event-attendance-test@example.com', name: 'P2 Att Test' }
        });
        testParticipant2Id = participant2.id;

        const program = await prisma.program.create({
            data: {
                name: 'Attendance Test Program',
                leadMentorId: testLeadMentorId,
                maxParticipants: 10,
                minAge: 5,
                maxAge: 18,
            }
        });
        testProgramId = program.id;

        const now = new Date();
        const pastStart = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2 hours ago
        const pastEnd = new Date(now.getTime() - 1 * 60 * 60 * 1000); // 1 hour ago

        const event = await prisma.event.create({
            data: {
                name: 'Attendance Test Event',
                programId: testProgramId,
                start: pastStart,
                end: pastEnd
            }
        });
        testEventId = event.id;
    });

    afterAll(async () => {
        // Clean up
        await prisma.visit.deleteMany({
            where: { participantId: { in: [testParticipant1Id, testParticipant2Id] } }
        });
        await prisma.event.deleteMany({
            where: { id: testEventId }
        });
        await prisma.program.deleteMany({
            where: { id: testProgramId }
        });
        await prisma.participant.deleteMany({
            where: { id: { in: [testAdminId, testUserId, testLeadMentorId, testParticipant1Id, testParticipant2Id] } }
        });
    });

    afterEach(async () => {
        // Clear visits created during tests
        await prisma.visit.deleteMany({
            where: { participantId: { in: [testParticipant1Id, testParticipant2Id] } }
        });
    });

    describe('POST /api/events/[id]/attendance', () => {
        it('should return 401 Unauthorized without session', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);

             const req = new Request(`http://localhost:4000/api/events/${testEventId}/attendance`, {
                 method: 'POST',
                 body: JSON.stringify({ participantIds: [testParticipant1Id] })
             });

             const res = await POST(req as any, { params: Promise.resolve({ id: String(testEventId) }) });
             expect(res.status).toBe(401);
        });

        it('should return 403 Forbidden for non-admin/non-lead-mentor users', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({
                 user: { id: testUserId, sysadmin: false, boardMember: false, keyholder: false }
             });

             const req = new Request(`http://localhost:4000/api/events/${testEventId}/attendance`, {
                 method: 'POST',
                 body: JSON.stringify({ participantIds: [testParticipant1Id] })
             });

             const res = await POST(req as any, { params: Promise.resolve({ id: String(testEventId) }) });
             expect(res.status).toBe(403);
        });

        it('should return 404 Not Found for invalid event ID', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, sysadmin: true, boardMember: false, keyholder: false }
            });

            const req = new Request(`http://localhost:4000/api/events/9999999/attendance`, {
                method: 'POST',
                body: JSON.stringify({ participantIds: [testParticipant1Id] })
            });

            const res = await POST(req as any, { params: Promise.resolve({ id: '9999999' }) });
            expect(res.status).toBe(404);
        });

        it('should create a synthetic visit for a participant with no existing visit', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testLeadMentorId, sysadmin: false, boardMember: false, keyholder: false }
            });

            const req = new Request(`http://localhost:4000/api/events/${testEventId}/attendance`, {
                method: 'POST',
                body: JSON.stringify({ participantIds: [testParticipant1Id] })
            });

            const res = await POST(req as any, { params: Promise.resolve({ id: String(testEventId) }) });
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.success).toBe(true);
            expect(data.processed).toBe(1);

            const visits = await prisma.visit.findMany({
                where: { participantId: testParticipant1Id, associatedEventId: testEventId }
            });
            expect(visits.length).toBe(1);
            expect(visits[0].arrived).not.toBeNull();
            expect(visits[0].departed).not.toBeNull();
        });

        it('should link an existing unassociated visit that overlaps with the event', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, sysadmin: true }
            });

            // Create a general visit that overlaps with the event
            const event = await prisma.event.findUnique({ where: { id: testEventId } });
            const earlyArrival = new Date(event!.start.getTime() - 30 * 60 * 1000); // Arrived 30 mins before event
            
            await prisma.visit.create({
                data: {
                    participantId: testParticipant2Id,
                    arrived: earlyArrival,
                    departed: null, // Still active
                }
            });

            const req = new Request(`http://localhost:4000/api/events/${testEventId}/attendance`, {
                method: 'POST',
                body: JSON.stringify({ participantIds: [testParticipant2Id] })
            });

            const res = await POST(req as any, { params: Promise.resolve({ id: String(testEventId) }) });
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.success).toBe(true);
            expect(data.processed).toBe(1);

            const visits = await prisma.visit.findMany({
                where: { participantId: testParticipant2Id }
            });
            expect(visits.length).toBe(1); // Should only be the one we created
            expect(visits[0].associatedEventId).toBe(testEventId); // It was successfully linked
            expect(visits[0].arrived.getTime()).toBe(earlyArrival.getTime()); // Validates it used the existing visit
        });
    });
});
