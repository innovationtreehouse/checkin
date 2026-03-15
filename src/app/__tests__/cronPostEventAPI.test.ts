import prisma from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { GET } from "../api/cron/post-event/route";

jest.mock("@/lib/email", () => ({
    sendEmail: jest.fn().mockResolvedValue(true)
}));

describe("GET /api/cron/post-event", () => {
    beforeEach(async () => {
        await prisma.visit.deleteMany({ where: { participant: { email: { contains: 'example.com' } } } });
        await prisma.rSVP.deleteMany({ where: { participant: { email: { contains: 'example.com' } } } });
        await prisma.event.deleteMany({ where: { name: { startsWith: 'Past Event' } } });
        await prisma.event.deleteMany({ where: { name: { startsWith: 'Future Event' } } });
        await prisma.program.deleteMany({ where: { name: 'Test Program' } });
        await prisma.toolStatus.deleteMany({ where: { user: { email: { contains: 'example.com' } } } });
        await prisma.householdLead.deleteMany({ where: { participant: { email: { contains: 'example.com' } } } });
        await prisma.participant.deleteMany({ where: { email: { contains: 'example.com' } } });
        await prisma.household.deleteMany({ where: { participants: { none: {} } } });
        jest.clearAllMocks();
    });

    it("should send emails for finished events and mark them as sent", async () => {
        // Setup data
        const lead = await prisma.participant.create({
            data: { email: "lead@example.com", name: "Lead Mentor" }
        });

        const program = await prisma.program.create({
            data: { name: "Test Program", leadMentorId: lead.id }
        });

        const now = new Date();
        const pastStart = new Date(now.getTime() - 3 * 60 * 60 * 1000); // 3 hours ago
        const pastEnd = new Date(now.getTime() - 2 * 60 * 60 * 1000);   // 2 hours ago

        const event = await prisma.event.create({
            data: {
                name: "Past Event",
                start: pastStart,
                end: pastEnd,
                programId: program.id,
                postEventEmailSent: false
            }
        });

        // Add some RSVPs and Visits
        const user = await prisma.participant.create({
            data: { email: "user@example.com", name: "User" }
        });
        
        await prisma.rSVP.create({
            data: { eventId: event.id, participantId: user.id, status: "ATTENDING" }
        });

        await prisma.visit.create({
            data: { associatedEventId: event.id, participantId: user.id, arrived: pastStart }
        });

        process.env.CRON_SECRET = 'test-secret';
        const req = new Request("http://localhost/api/cron/post-event", {
            headers: { 'authorization': 'Bearer test-secret' }
        });
        const res = await GET(req);
        expect(res.status).toBe(200);

        const data = await res.json();
        expect(data.success).toBe(true);
        expect(data.emailsSent).toBe(1);

        expect(sendEmail).toHaveBeenCalledTimes(1);
        expect(sendEmail).toHaveBeenCalledWith(
            "lead@example.com",
            `Action Required: Confirm Attendance for Past Event`,
            expect.stringContaining("Review & Confirm Attendance")
        );

        // Check DB
        const updatedEvent = await prisma.event.findUnique({ where: { id: event.id } });
        expect(updatedEvent?.postEventEmailSent).toBe(true);
    });

    it("should not send emails for events that haven't finished yet", async () => {
        const program = await prisma.program.create({
            data: { name: "Test Program" }
        });

        const now = new Date();
        const futureStart = new Date(now.getTime() + 1 * 60 * 60 * 1000);
        const futureEnd = new Date(now.getTime() + 2 * 60 * 60 * 1000);

        await prisma.event.create({
            data: {
                name: "Future Event",
                start: futureStart,
                end: futureEnd,
                programId: program.id,
                postEventEmailSent: false
            }
        });

        process.env.CRON_SECRET = 'test-secret';
        const req = new Request("http://localhost/api/cron/post-event", {
            headers: { 'authorization': 'Bearer test-secret' }
        });
        const res = await GET(req);
        
        const data = await res.json();
        expect(data.emailsSent).toBe(0);
        expect(sendEmail).not.toHaveBeenCalled();
    });

    it("should not double-send emails if postEventEmailSent is true", async () => {
        const program = await prisma.program.create({
            data: { name: "Test Program" }
        });

        const now = new Date();
        const pastStart = new Date(now.getTime() - 3 * 60 * 60 * 1000);
        const pastEnd = new Date(now.getTime() - 2 * 60 * 60 * 1000);

        await prisma.event.create({
            data: {
                name: "Past Event Sent",
                start: pastStart,
                end: pastEnd,
                programId: program.id,
                postEventEmailSent: true
            }
        });

        process.env.CRON_SECRET = 'test-secret';
        const req = new Request("http://localhost/api/cron/post-event", {
            headers: { 'authorization': 'Bearer test-secret' }
        });
        const res = await GET(req);
        
        const data = await res.json();
        expect(data.emailsSent).toBe(0);
        expect(sendEmail).not.toHaveBeenCalled();
    });
});
