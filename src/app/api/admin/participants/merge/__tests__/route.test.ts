import { POST } from "../route";
import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";

jest.mock("next-auth/next");
const mockGetServerSession = getServerSession as jest.Mock;

describe("Merge Participants API", () => {
    let pKeepId: number;
    let pMergeId: number;
    let householdId: number;

    beforeEach(async () => {
        // Setup mock session as a sysadmin
        mockGetServerSession.mockResolvedValue({
            user: { email: "admin@checkme.in", sysadmin: true }
        });

        // Create two participants
        const pKeep = await prisma.participant.create({
            data: {
                name: "Keep User",
                email: "keep@example.com",
            }
        });
        pKeepId = pKeep.id;

        const pMerge = await prisma.participant.create({
            data: {
                name: "Merge User",
                email: "merge@example.com",
                phone: "123-456-7890"
            }
        });
        pMergeId = pMerge.id;
    });

    afterEach(async () => {
        // Cleanup
        await prisma.visit.deleteMany({ where: { participantId: { in: [pKeepId, pMergeId] } } });
        await prisma.programParticipant.deleteMany({ where: { participantId: { in: [pKeepId, pMergeId] } } });
        await prisma.householdLead.deleteMany({ where: { participantId: { in: [pKeepId, pMergeId] } } });
        await prisma.participant.deleteMany({ where: { id: { in: [pKeepId, pMergeId] } } });
        if (householdId) {
            await prisma.household.deleteMany({ where: { id: householdId } });
        }
    });

    it("should successfully merge two participants", async () => {
        // Add some data to pMerge
        await prisma.visit.create({
            data: {
                participantId: pMergeId,
                arrived: new Date()
            }
        });

        const req = new Request("http://localhost/api/admin/participants/merge", {
            method: "POST",
            body: JSON.stringify({ keepId: pKeepId, mergeId: pMergeId })
        }) as any;

        const res = await POST(req);
        expect(res.status).toBe(200);

        const data = await res.json();
        expect(data.success).toBe(true);

        // Verify data was moved
        const visits = await prisma.visit.findMany({ where: { participantId: pKeepId } });
        expect(visits.length).toBe(1);

        // Verify kept user got merged user's phone
        const kept = await prisma.participant.findUnique({ where: { id: pKeepId } });
        expect(kept?.phone).toBe("123-456-7890");

        // Verify merged user was tombstoned
        const merged = await prisma.participant.findUnique({ where: { id: pMergeId } });
        expect(merged?.email).toContain("merged-");
        expect(merged?.email).toContain("@deleted.checkme.in");
        expect(merged?.phone).toBeNull();
    });

    it("should fail to merge if merged user is the lead of a household with other members", async () => {
        // Create household
        const hh = await prisma.household.create({
            data: { name: "Test Household" }
        });
        householdId = hh.id;

        // Assign both users to it, make merge user the lead
        await prisma.participant.update({ where: { id: pMergeId }, data: { householdId: hh.id } });
        await prisma.participant.update({ where: { id: pKeepId }, data: { householdId: hh.id } });
        await prisma.householdLead.create({
            data: { householdId: hh.id, participantId: pMergeId }
        });

        const req = new Request("http://localhost/api/admin/participants/merge", {
            method: "POST",
            body: JSON.stringify({ keepId: pKeepId, mergeId: pMergeId })
        }) as any;

        const res = await POST(req);
        expect(res.status).toBe(400);

        const data = await res.json();
        expect(data.error).toContain("lead of a household with other members");
    });
});
