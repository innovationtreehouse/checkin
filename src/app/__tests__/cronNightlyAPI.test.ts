/**
 * @jest-environment node
 */
import { GET } from '@/app/api/cron/nightly/route';
import prisma from '@/lib/prisma';
import { sendEmail } from '@/lib/email';

jest.mock('@/lib/email', () => ({
    sendEmail: jest.fn().mockResolvedValue(true)
}));

describe('Cron Nightly API Integration Tests', () => {
    let boardMemberId: number;
    let keyholderId: number;
    let normalUserId: number;

    let programId: number;
    let eventId: number;

    beforeAll(async () => {
        await cleanup();

        // Setup Users
        const board = await prisma.participant.create({
            data: { email: 'board-nightly@example.com', name: 'Board Member', boardMember: true }
        });
        boardMemberId = board.id;

        const keyholder = await prisma.participant.create({
            data: { email: 'keyholder-nightly@example.com', name: 'Forgetful Keyholder', keyholder: true }
        });
        keyholderId = keyholder.id;

        const normalUser = await prisma.participant.create({
            data: { email: 'user-nightly@example.com', name: 'Normal User' }
        });
        normalUserId = normalUser.id;

        // Setup Program & Event for emails
        const program = await prisma.program.create({
            data: {
                name: 'Nightly Test Program',
                leadMentorId: boardMemberId // Board member is also lead
            }
        });
        programId = program.id;

        const now = new Date();
        const justEndedStart = new Date(now.getTime() - 2 * 60 * 60 * 1000);
        // Event ended 5 minutes ago (would NOT trigger standard 1-hour cron, but SHOULD trigger nightly)
        const justEndedEnd = new Date(now.getTime() - 5 * 60 * 1000); 

        const event = await prisma.event.create({
            data: {
                name: 'Test Event - Nightly',
                start: justEndedStart,
                end: justEndedEnd,
                programId,
                postEventEmailSent: false
            }
        });
        eventId = event.id;

        await prisma.rSVP.create({
            data: { eventId, participantId: normalUserId, status: 'ATTENDING' }
        });

        // Setup Abandoned Visits
        await prisma.visit.create({
            data: { participantId: keyholderId, arrived: justEndedStart } // Never departed
        });

        await prisma.visit.create({
            data: { participantId: normalUserId, arrived: justEndedStart, associatedEventId: eventId } // Never departed
        });
    });

    afterAll(async () => {
        await cleanup();
    });

    async function cleanup() {
        // Broad cleanup for nightly tests
        await prisma.rSVP.deleteMany({ where: { participant: { email: { contains: '-nightly@' } } } });
        await prisma.visit.deleteMany({ where: { participant: { email: { contains: '-nightly@' } } } });
        await prisma.event.deleteMany({ where: { name: { startsWith: 'Test Event - Nightly' } } });
        await prisma.program.deleteMany({ where: { name: 'Nightly Test Program' } });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await prisma.auditLog.deleteMany({ where: { newData: { string_contains: 'keyholder-nightly' } as any } });
        await prisma.participant.deleteMany({
            where: { email: { contains: '-nightly@' } }
        });
    }

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /api/cron/nightly', () => {
        it('should force checkout abandoned visits and send post-event emails immediately', async () => {
            process.env.CRON_SECRET = 'test-secret';
            const req = new Request('http://localhost:4000/api/cron/nightly', {
                method: 'GET',
                headers: {
                    'authorization': 'Bearer test-secret'
                }
            });

            const res = await GET(req);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.success).toBe(true);

            // 1. Verify Facility Close Logic
            expect(data.facilityClose.checkedOutCount).toBe(2); // Keyholder + Normal User
            expect(data.facilityClose.boardNotified).toBe(true); // Because a keyholder was abandoned

            // 2. Verify Post-Event Email Logic
            expect(data.postEvents.processedEvents).toBe(1);
            expect(data.postEvents.emailsSent).toBe(1);

            // Db checks
            const abandonedVisits = await prisma.visit.findMany({
                where: { departed: null, participant: { email: { contains: '-nightly@' } } }
            });
            expect(abandonedVisits.length).toBe(0); // Everyone checked out

            const updatedEvent = await prisma.event.findUnique({ where: { id: eventId } });
            expect(updatedEvent?.postEventEmailSent).toBe(true); // Email sent

            expect(sendEmail).toHaveBeenCalledWith(
                'board-nightly@example.com',
                `Action Required: Confirm Attendance for Test Event - Nightly`,
                expect.stringContaining('Review & Confirm Attendance')
            );
        });
    });
});
