import { POST as JoinMembership } from "../api/membership/route";
import { POST as ShopifyWebhook } from "../api/webhooks/shopify/route";
import { POST as CertifyMembership } from "../api/admin/memberships/certify/route";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import crypto from "crypto";
import { sendEmail } from "@/lib/email";

jest.mock("next-auth/next");
const mockGetServerSession = getServerSession as jest.Mock;

jest.mock("@/lib/email", () => ({
    sendEmail: jest.fn().mockResolvedValue(true)
}));

describe("Membership Flow Integration", () => {
    const originalEnv = process.env;
    let createdHouseholdId: number;
    let board1Id: number;
    let board2Id: number;

    beforeEach(async () => {
        jest.clearAllMocks();
        process.env = { ...originalEnv, SHOPIFY_WEBHOOK_SECRET: "testsecret" };

        const b1 = await prisma.participant.create({ data: { name: "Board One", email: "board1@checkme.in", boardMember: true } });
        const b2 = await prisma.participant.create({ data: { name: "Board Two", email: "board2@checkme.in", boardMember: true } });
        board1Id = b1.id;
        board2Id = b2.id;
    });

    afterEach(async () => {
        process.env = originalEnv;

        if (createdHouseholdId) {
            // Cleanup
            await prisma.membership.deleteMany({ where: { householdId: createdHouseholdId } });
            await prisma.backgroundCheckCertification.deleteMany({ where: { householdId: createdHouseholdId } });
            await prisma.householdLead.deleteMany({ where: { householdId: createdHouseholdId } });
            await prisma.participant.deleteMany({ where: { householdId: createdHouseholdId } });
            await prisma.household.delete({ where: { id: createdHouseholdId } });
        }
        if (board1Id) await prisma.participant.deleteMany({ where: { id: board1Id } });
        if (board2Id) await prisma.participant.deleteMany({ where: { id: board2Id } });
    });

    it("should process a full membership application successfully", async () => {
        // Step 1: Submit Application
        const joinRes = await JoinMembership(new Request("http://localhost/api/membership", {
            method: "POST",
            body: JSON.stringify({
                leads: [{ name: "Test Parent 1", email: "test1@example.com", phone: "123", isPrimary: true }],
                children: [],
                emergencyContactName: "Emergency Guy",
                emergencyContactPhone: "911",
                healthInsuranceInfo: "Test Policy"
            })
        }) as any);

        expect(joinRes.status).toBe(200);
        const joinData = await joinRes.json();
        expect(joinData.success).toBe(true);
        createdHouseholdId = joinData.householdId;

        const hh = await prisma.household.findUnique({ where: { id: createdHouseholdId } });
        expect(hh?.membershipStatus).toBe("PENDING_PAYMENT");

        // Step 2: Shopify Webhook Payment
        const webhookBody = JSON.stringify({
            id: 99999,
            note_attributes: [
                { name: "Membership_Household_ID", value: createdHouseholdId.toString() }
            ]
        });

        const signature = crypto.createHmac("sha256", "testsecret").update(webhookBody, "utf8").digest("base64");
        
        const shopifyRes = await ShopifyWebhook(new Request("http://localhost/api/webhooks/shopify", {
            method: "POST",
            headers: new Headers({ "x-shopify-hmac-sha256": signature }),
            body: webhookBody
        }) as any);

        expect(shopifyRes.status).toBe(200);

        const hhAfterPaid = await prisma.household.findUnique({ where: { id: createdHouseholdId } });
        expect(hhAfterPaid?.membershipStatus).toBe("PENDING_BG_CHECK"); // Because no previous BG check

        // Step 3: Board Member 1 Certifies
        mockGetServerSession.mockResolvedValueOnce({
            user: { id: board1Id, email: "board1@checkme.in", boardMember: true }
        });

        const cert1Res = await CertifyMembership(new Request("http://localhost/api/admin/memberships/certify", {
            method: "POST",
            body: JSON.stringify({ householdId: createdHouseholdId })
        }) as any);

        expect(cert1Res.status).toBe(200);
        const cert1Data = await cert1Res.json();
        expect(cert1Data.status).toBe("PENDING_BG_CHECK"); // Still pending

        // Step 4: Board Member 2 Certifies
        mockGetServerSession.mockResolvedValueOnce({
            user: { id: board2Id, email: "board2@checkme.in", boardMember: true }
        });

        const cert2Res = await CertifyMembership(new Request("http://localhost/api/admin/memberships/certify", {
            method: "POST",
            body: JSON.stringify({ householdId: createdHouseholdId })
        }) as any);

        expect(cert2Res.status).toBe(200);
        const cert2Data = await cert2Res.json();
        expect(cert2Data.status).toBe("APPROVED");

        // Verify status in DB
        const finalHh = await prisma.household.findUnique({ where: { id: createdHouseholdId } });
        expect(finalHh?.membershipStatus).toBe("APPROVED");

        // Verify Membership Record Created
        const ms = await prisma.membership.findFirst({ where: { householdId: createdHouseholdId } });
        expect(ms).not.toBeNull();
        expect(ms?.active).toBe(true);
        expect(ms?.latestShopifyReceipt).toBe("99999");
        
        // Ensure Welcome Email was sent
        expect(sendEmail).toHaveBeenCalledWith(
            "test1@example.com",
            "Welcome to the Treehouse!",
            expect.any(String)
        );
    });
});
