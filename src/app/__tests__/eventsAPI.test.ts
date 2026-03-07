/**
 * @jest-environment node
 */
/**
 * Integration Tests for Events API
 * Tests POST /api/events for single and recurring event generation
 */

import { POST } from '@/app/api/events/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';

// Mock NextAuth
jest.mock('next-auth', () => ({
    getServerSession: jest.fn(),
}));

jest.mock('@/app/api/auth/[...nextauth]/route', () => ({
    authOptions: {}
}));

describe('Events API Integration Tests', () => {
    let testAdminId: number;
    let testUserId: number;
    let testLeadMentorId: number;
    let testProgramId: number;

    beforeAll(async () => {
        // Clean up any leaked state
        await prisma.event.deleteMany({
            where: { name: { contains: 'Test Event' } }
        });
        await prisma.program.deleteMany({
            where: { name: 'Events Test Program' }
        });
        await prisma.participant.deleteMany({
            where: { email: { contains: 'events-api-test' } }
        });

        // Setup mock database records
        const admin = await prisma.participant.create({
            data: { email: 'admin-events-api-test@example.com', name: 'Admin Events Test', sysadmin: true }
        });
        testAdminId = admin.id;

        const user = await prisma.participant.create({
            data: { email: 'user-events-api-test@example.com', name: 'User Events Test' }
        });
        testUserId = user.id;

        const mentor = await prisma.participant.create({
            data: { email: 'mentor-events-api-test@example.com', name: 'Mentor Events Test' }
        });
        testLeadMentorId = mentor.id;

        const program = await prisma.program.create({
            data: {
                name: 'Events Test Program',
                leadMentorId: testLeadMentorId,
                maxParticipants: 10,
                minAge: 5,
                maxAge: 18,
            }
        });
        testProgramId = program.id;
    });

    afterAll(async () => {
        // Clean up
        await prisma.event.deleteMany({
            where: { name: { contains: 'Test Event' } }
        });
        await prisma.program.deleteMany({
            where: { id: testProgramId }
        });
        await prisma.participant.deleteMany({
            where: { id: { in: [testAdminId, testUserId, testLeadMentorId] } }
        });
    });

    describe('POST /api/events', () => {
        it('should return 401 Unauthorized without session', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);

             const req = new Request('http://localhost:4000/api/events', {
                 method: 'POST',
                 body: JSON.stringify({ name: 'Test Event' })
             });

             const res = await POST(req as any);
             expect(res.status).toBe(401);
        });

        it('should return 403 Forbidden for non-admin users who are not lead mentors', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({
                 user: { id: testUserId, sysadmin: false, boardMember: false }
             });

             const req = new Request('http://localhost:4000/api/events', {
                 method: 'POST',
                 body: JSON.stringify({ name: 'Test Event', programId: testProgramId, startDate: '2025-01-01', startTime: '10:00', endTime: '12:00' })
             });

             const res = await POST(req as any);
             expect(res.status).toBe(403);
        });

        it('should return 400 Bad Request if required fields are missing', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, sysadmin: true, boardMember: false }
            });

            const req = new Request('http://localhost:4000/api/events', {
                method: 'POST',
                body: JSON.stringify({ name: 'Test Event Missing Dates' }) // Missing startDate, etc
            });

            const res = await POST(req as any);
            expect(res.status).toBe(400);
            
            const data = await res.json();
            expect(data.error).toBe('Missing required fields');
        });

        it('should successfully create a single event as admin', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, sysadmin: true, boardMember: false }
            });

            const req = new Request('http://localhost:4000/api/events', {
                method: 'POST',
                body: JSON.stringify({
                    name: 'Single Test Event',
                    description: 'A test event description',
                    programId: testProgramId,
                    startDate: '2026-10-01',
                    startTime: '13:00',
                    endTime: '15:00'
                })
            });

            const res = await POST(req as any);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.success).toBe(true);
            expect(data.count).toBe(1);

            const events = await prisma.event.findMany({ where: { name: 'Single Test Event' } });
            expect(events.length).toBe(1);
            expect(events[0].programId).toBe(testProgramId);
            // Verify correct hours parsed
            expect(events[0].start.toISOString()).toContain('T13:00:00');
            expect(events[0].end.toISOString()).toContain('T15:00:00');
        });

        it('should successfully create recurring events as a lead mentor', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testLeadMentorId, sysadmin: false, boardMember: false }
            });

            // Recurrence: from Oct 1 to Oct 15, on Mon (1) and Wed (3).
            // Oct 1 2026 is a Thursday.
            // Expected dates: Oct 5(Mon), Oct 7(Wed), Oct 12(Mon), Oct 14(Wed) -> 4 events.
            const req = new Request('http://localhost:4000/api/events', {
                method: 'POST',
                body: JSON.stringify({
                    name: 'Recurring Test Event',
                    programId: testProgramId,
                    startDate: '2026-10-01',
                    startTime: '09:00',
                    endTime: '11:00',
                    recurrence: {
                        daysOfWeek: [1, 3], 
                        until: '2026-10-15'
                    }
                })
            });

            const res = await POST(req as any);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.success).toBe(true);
            expect(data.count).toBe(4);

            const events = await prisma.event.findMany({ where: { name: 'Recurring Test Event' } });
            expect(events.length).toBe(4);
        });
    });
});
