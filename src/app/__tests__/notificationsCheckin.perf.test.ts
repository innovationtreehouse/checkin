import { sendCheckinNotifications } from "@/lib/notifications";
import { sendEmail } from "@/lib/email";
import prisma from "@/lib/prisma";

jest.mock("@/lib/email", () => ({
    sendEmail: jest.fn().mockImplementation(() => new Promise(resolve => setTimeout(resolve, 50))) // Simulate 50ms delay per email
}));

jest.mock("@/lib/prisma", () => ({
    participant: {
        findUnique: jest.fn().mockResolvedValue({
            id: 1,
            name: "Test Participant",
            email: "participant@example.com",
            notificationSettings: {
                emailCheckinReceipts: true
            },
            householdId: 1
        })
    },
    householdLead: {
        findMany: jest.fn().mockResolvedValue(
            Array.from({ length: 10 }).map((_, i) => ({
                participant: {
                    id: 2 + i,
                    name: `Lead ${i}`,
                    email: `lead${i}@example.com`,
                    notificationSettings: {
                        emailDependentCheckins: true
                    }
                }
            }))
        )
    }
}));

describe("Performance: sendCheckinNotifications", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("should send notifications in parallel", async () => {
        const start = Date.now();
        await sendCheckinNotifications(1, "checkin");
        const end = Date.now();
        const duration = end - start;

        console.log(`Execution time: ${duration}ms`);
        expect(sendEmail).toHaveBeenCalledTimes(11);

        // If emails are sent sequentially, it should take at least 50ms * 11 = 550ms.
        // If sent in parallel (Promise.all), it should take around 50ms.
        expect(duration).toBeLessThan(400);
    });
});
