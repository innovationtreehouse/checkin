/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @jest-environment node
 */
/**
 * Integration Tests for Event RSVP API
 * Tests PATCH /api/events/[id]/rsvp for updating participant's RSVP status
 */

import { PATCH } from '@/app/api/events/[id]/rsvp/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';

// Mock NextAuth
jest.mock('next-auth', () => ({
    getServerSession: jest.fn(),
}));

jest.mock('@/app/api/auth/[...nextauth]/route', () => ({
    authOptions: {}
}));

describe('Event RSVP API Integration Tests', () => {
    let testUserId: number;
    let testUnenrolledUserId: number;
    let testProgramId: number;
    let testEventId: number;

    beforeAll(async () => {
        // Clean up any leaked state
        await prisma.rSVP.deleteMany({
            where: { participant: { email: { contains: 'rsvp-test' } } }
        });
        await prisma.event.deleteMany({
            where: { name: 'RSVP Test Event' }
        });
        await prisma.programParticipant.deleteMany({
            where: { participant: { email: { contains: 'rsvp-test' } } }
        });
        await prisma.program.deleteMany({
            where: { name: 'RSVP Test Program' }
        });
        await prisma.participant.deleteMany({
            where: { email: { contains: 'rsvp-test' } }
        });

        // Setup mock database records
        const user = await prisma.participant.create({
            data: { email: 'enrolled-user-rsvp-test@example.com', name: 'Enrolled RSVP Test' }
        });
        testUserId = user.id;

        const unenrolledUser = await prisma.participant.create({
            data: { email: 'unenrolled-user-rsvp-test@example.com', name: 'Unenrolled RSVP Test' }
        });
        testUnenrolledUserId = unenrolledUser.id;

        const program = await prisma.program.create({
            data: {
                name: 'RSVP Test Program',
                leadMentorId: testUserId,
                maxParticipants: 10,
                minAge: 5,
                maxAge: 18,
            }
        });
        testProgramId = program.id;

        // Enroll the enrolled user
        await prisma.programParticipant.create({
            data: {
                programId: testProgramId,
                participantId: testUserId
            }
        });

        const now = new Date();
        const start = new Date(now.getTime() + 1 * 60 * 60 * 1000); // 1 hour from now

        const event = await prisma.event.create({
            data: {
                name: 'RSVP Test Event',
                programId: testProgramId,
                start: start,
                end: new Date(start.getTime() + 2 * 60 * 60 * 1000)
            }
        });
        testEventId = event.id;
    });

    afterAll(async () => {
        // Clean up
        await prisma.rSVP.deleteMany({
            where: { participantId: { in: [testUserId, testUnenrolledUserId] } }
        });
        await prisma.event.deleteMany({
            where: { id: testEventId }
        });
        await prisma.programParticipant.deleteMany({
            where: { programId: testProgramId }
        });
        await prisma.program.deleteMany({
            where: { id: testProgramId }
        });
        await prisma.participant.deleteMany({
            where: { id: { in: [testUserId, testUnenrolledUserId] } }
        });
    });

    describe('PATCH /api/events/[id]/rsvp', () => {
        it('should return 401 Unauthorized without session', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);

             const req = new Request(`http://localhost:4000/api/events/${testEventId}/rsvp`, {
                 method: 'PATCH',
                 body: JSON.stringify({ status: 'ATTENDING' })
             });

             const res = await PATCH(req as any, { params: Promise.resolve({ id: String(testEventId) }) });
             expect(res.status).toBe(401);
        });

        it('should return 400 Bad Request for invalid RSVP status', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({
                 user: { id: testUserId }
             });

             const req = new Request(`http://localhost:4000/api/events/${testEventId}/rsvp`, {
                 method: 'PATCH',
                 body: JSON.stringify({ status: 'INVALID_STATUS' })
             });

             const res = await PATCH(req as any, { params: Promise.resolve({ id: String(testEventId) }) });
             expect(res.status).toBe(400);

             const data = await res.json();
             expect(data.error).toBe('Invalid RSVP status');
        });

        it('should return 404 Not Found for invalid event ID', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testUserId }
            });

            const req = new Request(`http://localhost:4000/api/events/9999999/rsvp`, {
                method: 'PATCH',
                body: JSON.stringify({ status: 'ATTENDING' })
            });

            const res = await PATCH(req as any, { params: Promise.resolve({ id: '9999999' }) });
            expect(res.status).toBe(404);
        });

        it('should return 403 Forbidden if user is not enrolled in the program for the event', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testUnenrolledUserId }
            });

            const req = new Request(`http://localhost:4000/api/events/${testEventId}/rsvp`, {
                method: 'PATCH',
                body: JSON.stringify({ status: 'ATTENDING' })
            });

            const res = await PATCH(req as any, { params: Promise.resolve({ id: String(testEventId) }) });
            expect(res.status).toBe(403);
            
            const data = await res.json();
            expect(data.error).toContain('Forbidden');
        });

        it('should successfully create an RSVP for an enrolled participant', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testUserId }
            });

            const req = new Request(`http://localhost:4000/api/events/${testEventId}/rsvp`, {
                method: 'PATCH',
                body: JSON.stringify({ status: 'ATTENDING' })
            });

            const res = await PATCH(req as any, { params: Promise.resolve({ id: String(testEventId) }) });
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.success).toBe(true);
            expect(data.rsvp.status).toBe('ATTENDING');

            const rsvpRecord = await prisma.rSVP.findUnique({
                where: {
                    eventId_participantId: {
                        eventId: testEventId,
                        participantId: testUserId
                    }
                }
            });
            expect(rsvpRecord).toBeDefined();
            expect(rsvpRecord?.status).toBe('ATTENDING');
        });

        it('should successfully update an existing RSVP', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testUserId }
            });

            // Make sure the record exists from the previous test or create it
            await prisma.rSVP.upsert({
                where: {
                    eventId_participantId: {
                        eventId: testEventId,
                        participantId: testUserId
                    }
                },
                update: { status: 'ATTENDING' },
                create: {
                    eventId: testEventId,
                    participantId: testUserId,
                    status: 'ATTENDING'
                }
            });

            const req = new Request(`http://localhost:4000/api/events/${testEventId}/rsvp`, {
                method: 'PATCH',
                body: JSON.stringify({ status: 'NOT_ATTENDING' })
            });

            const res = await PATCH(req as any, { params: Promise.resolve({ id: String(testEventId) }) });
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.success).toBe(true);
            expect(data.rsvp.status).toBe('NOT_ATTENDING');

            const rsvpRecord = await prisma.rSVP.findUnique({
                where: {
                    eventId_participantId: {
                        eventId: testEventId,
                        participantId: testUserId
                    }
                }
            });
            expect(rsvpRecord?.status).toBe('NOT_ATTENDING');
        });
    });
});
