/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @jest-environment node
 */
/**
 * Integration Tests for Cron Reminders API
 * Tests GET /api/cron/reminders for processing upcoming events and sending notification triggers
 */

import { GET } from '@/app/api/cron/reminders/route';
import prisma from '@/lib/prisma';
import { sendNotification } from '@/lib/notifications';

// Mock the notification sender
jest.mock('@/lib/notifications', () => ({
    sendNotification: jest.fn()
}));

describe('Cron Reminders API Integration Tests', () => {
    let testUserId: number;
    let upcomingEventId: number;
    let pastEventId: number;
    let farFutureEventId: number;

    beforeAll(async () => {
        // Clean up any leaked state
        const existingUsers = await prisma.participant.findMany({
            where: { email: { contains: 'cron-reminders-test' } },
            select: { id: true }
        });
        
        const existingUserIds = existingUsers.map(u => u.id);
        
        await prisma.rSVP.deleteMany({
            where: { participantId: { in: existingUserIds } }
        });
        
        await prisma.participant.deleteMany({
            where: { email: { contains: 'cron-reminders-test' } }
        });

        await prisma.event.deleteMany({
            where: { name: { contains: 'Cron Test Event' } }
        });

        // Setup mock database records
        const user = await prisma.participant.create({
            data: { email: 'user-cron-reminders-test@example.com', name: 'User Cron Reminders Test' }
        });
        testUserId = user.id;

        const now = new Date();
        const twoHoursFiveMinsFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000 + 5 * 60 * 1000);
        
        // This event should be picked up (starts in 2h 5m)
        const upcomingEvent = await prisma.event.create({
            data: {
                name: 'Cron Test Event - Upcoming',
                start: twoHoursFiveMinsFromNow,
                end: new Date(twoHoursFiveMinsFromNow.getTime() + 3600000),
                description: 'Test Event'
            }
        });
        upcomingEventId = upcomingEvent.id;

        // This event is already happening / past
        const pastEvent = await prisma.event.create({
            data: {
                name: 'Cron Test Event - Past',
                start: new Date(now.getTime() - 3600000),
                end: new Date(now.getTime() + 3600000),
                description: 'Test Event'
            }
        });
        pastEventId = pastEvent.id;

        // This event is too far in the future
        const farFutureEvent = await prisma.event.create({
            data: {
                name: 'Cron Test Event - Far Future',
                start: new Date(now.getTime() + 24 * 60 * 60 * 1000),
                end: new Date(now.getTime() + 25 * 60 * 60 * 1000),
                description: 'Test Event'
            }
        });
        farFutureEventId = farFutureEvent.id;

        // Create RSVPs
        await prisma.rSVP.createMany({
            data: [
                { eventId: upcomingEventId, participantId: testUserId, status: 'ATTENDING' },
                { eventId: pastEventId, participantId: testUserId, status: 'ATTENDING' },
                { eventId: farFutureEventId, participantId: testUserId, status: 'ATTENDING' }
            ]
        });
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterAll(async () => {
        // Clean up
        await prisma.rSVP.deleteMany({
            where: { participantId: testUserId }
        });
        await prisma.event.deleteMany({
            where: { id: { in: [upcomingEventId, pastEventId, farFutureEventId] } }
        });
        await prisma.participant.deleteMany({
            where: { id: testUserId }
        });
    });

    describe('GET /api/cron/reminders', () => {
        it('should process events within the 2-hour window and send notifications to ATTENDING RSVPs', async () => {
            process.env.CRON_SECRET = 'test-secret';
            const req = new Request('http://localhost:4000/api/cron/reminders', {
                method: 'GET',
                headers: {
                    'authorization': 'Bearer test-secret'
                }
            });

            const res = await GET(req as any);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.success).toBe(true);

            // Our single upcoming event within the [2h, 2h15m] window should be processed
            expect(data.processedEvents).toBeGreaterThanOrEqual(1);
            expect(data.notificationsSent).toBeGreaterThanOrEqual(1);

            // Verify sendNotification was called for the upcoming event
            expect(sendNotification).toHaveBeenCalledWith(
                testUserId,
                'EVENT_STARTING_SOON',
                expect.objectContaining({
                    eventName: 'Cron Test Event - Upcoming',
                    hours: 2
                })
            );

            // Verify it was NOT called for past or far future events
            const calls = (sendNotification as jest.Mock).mock.calls;
            const pastEventCalls = calls.filter(call => call[2].eventName === 'Cron Test Event - Past');
            const futureEventCalls = calls.filter(call => call[2].eventName === 'Cron Test Event - Far Future');
            
            expect(pastEventCalls.length).toBe(0);
            expect(futureEventCalls.length).toBe(0);
        });
    });
});
