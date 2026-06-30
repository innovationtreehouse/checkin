/**
 * @jest-environment node
 */
/**
 * Integration Tests for My Events API
 * Tests GET /api/events/mine for fetching a user's upcoming events based on enrollments/volunteering
 */

import { GET } from '@/app/api/events/mine/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
// Mock NextAuth
jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn(),
}));
describe('My Events API Integration Tests', () => {
    let testUserId: number;
    let testVolunteerId: number;
    let testProgram1Id: number;
    let testProgram2Id: number;
    let testEventUpcoming1Id: number;
    let testEventUpcoming2Id: number;
    let testEventPastId: number;

    beforeAll(async () => {
        // Clean up any leaked state
        await prisma.rSVP.deleteMany({
            where: { participant: { email: { contains: 'mine-events-test' } } }
        });
        await prisma.event.deleteMany({
            where: { name: { contains: 'Mine Test Event' } }
        });
        await prisma.programParticipant.deleteMany({
            where: { participant: { email: { contains: 'mine-events-test' } } }
        });
        await prisma.programVolunteer.deleteMany({
            where: { participant: { email: { contains: 'mine-events-test' } } }
        });
        await prisma.program.deleteMany({
            where: { name: { contains: 'Mine Test Program' } }
        });
        await prisma.participant.deleteMany({
            where: { email: { contains: 'mine-events-test' } }
        });

        // Setup mock database records
        const user = await prisma.participant.create({
            data: { email: 'user-mine-events-test@example.com', name: 'User Mine Test', household: { create: {} } }
        });
        testUserId = user.id;

        const volunteer = await prisma.participant.create({
            data: { email: 'volunteer-mine-events-test@example.com', name: 'Volunteer Mine Test', household: { create: {} } }
        });
        testVolunteerId = volunteer.id;

        const program1 = await prisma.program.create({
            data: {
                name: 'Mine Test Program 1',
                maxParticipants: 10,
                minAge: 5,
                maxAge: 18,
            }
        });
        testProgram1Id = program1.id;

        const program2 = await prisma.program.create({
            data: {
                name: 'Mine Test Program 2',
                maxParticipants: 10,
                minAge: 5,
                maxAge: 18,
            }
        });
        testProgram2Id = program2.id;

        // User is enrolled in Program 1
        await prisma.programParticipant.create({
            data: {
                programId: testProgram1Id,
                participantId: testUserId
            }
        });

        // Volunteer is volunteering in Program 2
        await prisma.programVolunteer.create({
            data: {
                programId: testProgram2Id,
                participantId: testVolunteerId
            }
        });

        const now = new Date();
        const futureStart1 = new Date(now.getTime() + 1 * 60 * 60 * 1000); // 1 hr future
        const futureStart2 = new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2 hrs future
        const pastStart = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2 hrs past

        // Event for Program 1 (upcoming)
        const event1 = await prisma.event.create({
            data: {
                name: 'Mine Test Event Upcoming 1',
                programId: testProgram1Id,
                startAt: futureStart1,
                endAt: new Date(futureStart1.getTime() + 1 * 60 * 60 * 1000)
            }
        });
        testEventUpcoming1Id = event1.id;

        // Event for Program 1 (past) - should not be returned
        const eventPast = await prisma.event.create({
            data: {
                name: 'Mine Test Event Past',
                programId: testProgram1Id,
                startAt: pastStart,
                endAt: new Date(pastStart.getTime() + 1 * 60 * 60 * 1000)
            }
        });
        testEventPastId = eventPast.id;

        // Event for Program 2 (upcoming)
        const event2 = await prisma.event.create({
            data: {
                name: 'Mine Test Event Upcoming 2',
                programId: testProgram2Id,
                startAt: futureStart2,
                endAt: new Date(futureStart2.getTime() + 1 * 60 * 60 * 1000)
            }
        });
        testEventUpcoming2Id = event2.id;

        // RSVP for the user on event 1
        await prisma.rSVP.create({
            data: {
                eventId: testEventUpcoming1Id,
                participantId: testUserId,
                status: 'ATTENDING'
            }
        });
    });

    afterAll(async () => {
        // Clean up
        await prisma.rSVP.deleteMany({
            where: { participantId: { in: [testUserId, testVolunteerId] } }
        });
        await prisma.event.deleteMany({
            where: { id: { in: [testEventUpcoming1Id, testEventUpcoming2Id, testEventPastId] } }
        });
        await prisma.programParticipant.deleteMany({
            where: { programId: { in: [testProgram1Id, testProgram2Id] } }
        });
        await prisma.programVolunteer.deleteMany({
            where: { programId: { in: [testProgram1Id, testProgram2Id] } }
        });
        await prisma.program.deleteMany({
            where: { id: { in: [testProgram1Id, testProgram2Id] } }
        });
        // RESTRICT: delete participants before their (auto-created) households.
        const householdIds = (await prisma.participant.findMany({
            where: { id: { in: [testUserId, testVolunteerId] } },
            select: { householdId: true }
        })).map(p => p.householdId);

        await prisma.participant.deleteMany({
            where: { id: { in: [testUserId, testVolunteerId] } }
        });
        await prisma.household.deleteMany({
            where: { id: { in: householdIds } }
        });
    });

    describe('GET /api/events/mine', () => {
        it('should return 401 Unauthorized without session', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);
             const res = await GET() as Response;
             expect(res.status).toBe(401);
        });

        it('should return upcoming events for enrolled programs including RSVPs', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({
                 user: { id: testUserId }
             });
             const res = await GET() as Response;
             expect(res.status).toBe(200);

             const data = await res.json();
             expect(Array.isArray(data)).toBe(true);
             expect(data.length).toBe(1); // Only the 1 upcoming event for Program 1
             
             const event = data[0];
             expect(event.name).toBe('Mine Test Event Upcoming 1');
             // One row per (event, household member); rsvp is that member's status.
             expect(event.participant.id).toBe(testUserId);
             expect(event.rsvp).toBe('ATTENDING');
        });

        it('should return upcoming events for volunteer programs', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testVolunteerId }
            });
            const res = await GET() as Response;
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(Array.isArray(data)).toBe(true);
            expect(data.length).toBe(1); // Only the upcoming event for Program 2
            
            expect(data[0].name).toBe('Mine Test Event Upcoming 2');
        });

        it('should not return past events', async () => {
            // Already verified via array counts above, but explicitly checking it's missing
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testUserId }
            });
            const res = await GET() as Response;
            const data = await res.json();
            
            const hasPastEvent = data.some((e: { name: string }) => e.name === 'Mine Test Event Past');
            expect(hasPastEvent).toBe(false);
        });
    });
});
