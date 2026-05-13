 
import prisma from "@/lib/prisma";
import { sendCheckinNotifications } from "@/lib/notifications";
import { sendEmail } from "@/lib/email";

jest.mock("@/lib/email", () => ({
    sendEmail: jest.fn().mockResolvedValue(true)
}));

describe("sendCheckinNotifications()", () => {
    let leadId: number;
    let dependentId: number;
    let householdId: number;

    beforeEach(async () => {
        // Clean up
        await prisma.visit.deleteMany();
        await prisma.householdLead.deleteMany();
        await prisma.household.deleteMany();
        await prisma.participant.deleteMany({
            where: { email: { contains: "notify-test" } }
        });
        jest.clearAllMocks();

        // Create household
        const hh = await prisma.household.create({ data: {} });
        householdId = hh.id;

        // Create Lead
        const lead = await prisma.participant.create({
            data: {
                email: "lead-notify-test@example.com",
                name: "Test Lead",
                householdId,
                notificationSettings: {
                    emailDependentCheckins: true,
                    emailCheckinReceipts: false
                }
            }
        });
        leadId = lead.id;

        await prisma.householdLead.create({
            data: { householdId, participantId: leadId }
        });

        // Create Dependent
        const dependent = await prisma.participant.create({
            data: {
                email: "dependent-notify-test@example.com",
                name: "Test Dependent",
                householdId,
                notificationSettings: {
                    emailDependentCheckins: false, // dependents don't need this
                    emailCheckinReceipts: true
                }
            }
        });
        dependentId = dependent.id;
    });

    afterAll(async () => {
        await prisma.visit.deleteMany();
        await prisma.householdLead.deleteMany();
        await prisma.household.deleteMany();
        await prisma.participant.deleteMany({
            where: { email: { contains: "notify-test" } }
        });
    });

    it("should send a check-in receipt to the participant if opted in", async () => {
        await sendCheckinNotifications(dependentId, "checkin");
        
        // Should send email to dependent (receipt) AND lead (dependent checkin)
        expect(sendEmail).toHaveBeenCalledTimes(2);
        expect(sendEmail).toHaveBeenCalledWith(
            "dependent-notify-test@example.com",
            expect.stringContaining("✅ Test Dependent checked in to"),
            expect.stringContaining("Test Dependent")
        );
    });

    it("should send a notification to the household lead when a dependent checks in", async () => {
        await sendCheckinNotifications(dependentId, "checkin");
        
        expect(sendEmail).toHaveBeenCalledWith(
            "lead-notify-test@example.com",
            expect.stringContaining("✅ Test Dependent checked in to"),
            expect.stringContaining("Household Member Arrival")
        );
    });

    it("should NOT send a receipt if participant opted out", async () => {
        // Lead opted out of checkin receipts
        await sendCheckinNotifications(leadId, "checkout");
        
        // Should only be 0 times, because lead has no leads above them that opted in (they are the lead, and they checking in won't double notify themselves)
        expect(sendEmail).toHaveBeenCalledTimes(0);
    });
});
