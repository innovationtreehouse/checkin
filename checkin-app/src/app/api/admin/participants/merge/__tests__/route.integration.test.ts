import { POST } from "../route";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";

jest.mock("next-auth/next");
const mockGetServerSession = getServerSession as jest.Mock;

describe("Merge Participants API", () => {
    let pKeepId: number;
    let pMergeId: number;
    let householdId: number;
    let actorId: number;

    beforeEach(async () => {
        // Create a household for the participants (every participant must belong to one)
        const hh = await prisma.household.create({
            data: { name: "Merge Test Household" }
        });
        householdId = hh.id;

        // The acting board member — audit rows record actorId from the session.
        const actor = await prisma.participant.create({
            data: {
                name: "Board Actor",
                email: "actor@checkme.in",
                householdId: hh.id,
                boardMember: true,
            }
        });
        actorId = actor.id;

        // Setup mock session as the board member
        mockGetServerSession.mockResolvedValue({
            user: { id: actorId, email: "actor@checkme.in", boardMember: true }
        });

        // Create two participants
        const pKeep = await prisma.participant.create({
            data: {
                name: "Keep User",
                email: "keep@example.com",
                householdId: hh.id,
            }
        });
        pKeepId = pKeep.id;

        const pMerge = await prisma.participant.create({
            data: {
                name: "Merge User",
                email: "merge@example.com",
                phone: "123-456-7890",
                householdId: hh.id,
            }
        });
        pMergeId = pMerge.id;
    });

    afterEach(async () => {
        // Cleanup
        await prisma.visit.deleteMany({ where: { participantId: { in: [pKeepId, pMergeId] } } });
        await prisma.programParticipant.deleteMany({ where: { participantId: { in: [pKeepId, pMergeId] } } });
        await prisma.householdLead.deleteMany({ where: { participantId: { in: [pKeepId, pMergeId] } } });
        await prisma.auditLog.deleteMany({ where: { actorId } });
        await prisma.participant.deleteMany({ where: { id: { in: [pKeepId, pMergeId, actorId] } } });
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
        }) as unknown as import('next/server').NextRequest;

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

    it("should write an AuditLog row capturing the merge", async () => {
        await prisma.visit.create({
            data: { participantId: pMergeId, arrived: new Date() }
        });

        const req = new Request("http://localhost/api/admin/participants/merge", {
            method: "POST",
            body: JSON.stringify({ keepId: pKeepId, mergeId: pMergeId })
        }) as unknown as import('next/server').NextRequest;

        const res = await POST(req);
        expect(res.status).toBe(200);

        const log = await prisma.auditLog.findFirst({
            where: { tableName: "Participant", affectedEntityId: pKeepId, secondaryAffectedEntity: pMergeId }
        });
        expect(log).not.toBeNull();
        expect(log?.actorId).toBe(actorId);
        const newData = log?.newData as { keepId: number; moved: { visits: number } };
        expect(newData.keepId).toBe(pKeepId);
        expect(newData.moved.visits).toBe(1);
    });

    it("should fail to merge if merged user is the lead of a household with other members", async () => {
        // Both users already share a household (from beforeEach); make merge user the lead
        await prisma.householdLead.create({
            data: { householdId, participantId: pMergeId }
        });

        const req = new Request("http://localhost/api/admin/participants/merge", {
            method: "POST",
            body: JSON.stringify({ keepId: pKeepId, mergeId: pMergeId })
        }) as unknown as import('next/server').NextRequest;

        const res = await POST(req);
        expect(res.status).toBe(400);

        const data = await res.json();
        expect(data.error).toContain("lead of a household with other members");
    });
});
