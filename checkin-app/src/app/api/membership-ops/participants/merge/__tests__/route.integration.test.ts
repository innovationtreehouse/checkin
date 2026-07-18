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
    // Set by the conflict test; torn down in afterEach.
    let createdProgramId: number | undefined;
    let createdFeeId: number | undefined;

    beforeEach(async () => {
        // Create a household for the participants (every participant must belong to one)
        const hh = await prisma.household.create({
            data: { name: "Merge Test Household" }
        });
        householdId = hh.id;

        // The acting board member — audit rows record actorId from the session.
        const actor = await prisma.person.create({
            data: {
                name: "Board Actor",
                email: "actor@checkme.in",
                householdId: hh.id,
                isBoardMember: true,
            }
        });
        actorId = actor.id;

        // Setup mock session as the board member
        mockGetServerSession.mockResolvedValue({
            user: { id: actorId, email: "actor@checkme.in", isBoardMember: true }
        });

        // Create two participants
        const pKeep = await prisma.person.create({
            data: {
                name: "Keep User",
                email: "keep@example.com",
                householdId: hh.id,
            }
        });
        pKeepId = pKeep.id;

        const pMerge = await prisma.person.create({
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
        // Cleanup. FeePayment / ProgramParticipant FK participant with RESTRICT, so
        // they must go before the participants.
        await prisma.feePayment.deleteMany({ where: { personId: { in: [pKeepId, pMergeId] } } });
        await prisma.visit.deleteMany({ where: { personId: { in: [pKeepId, pMergeId] } } });
        await prisma.programParticipant.deleteMany({ where: { personId: { in: [pKeepId, pMergeId] } } });
        await prisma.auditLog.deleteMany({ where: { actorId } });
        await prisma.person.deleteMany({ where: { id: { in: [pKeepId, pMergeId, actorId] } } });
        if (createdFeeId) {
            await prisma.fee.deleteMany({ where: { id: createdFeeId } });
            createdFeeId = undefined;
        }
        if (createdProgramId) {
            await prisma.program.deleteMany({ where: { id: createdProgramId } });
            createdProgramId = undefined;
        }
        if (householdId) {
            await prisma.household.deleteMany({ where: { id: householdId } });
        }
    });

    it("should successfully merge two participants", async () => {
        // Add some data to pMerge
        await prisma.visit.create({
            data: {
                personId: pMergeId,
                arrivedAt: new Date()
            }
        });

        const req = new Request("http://localhost/api/membership-ops/participants/merge", {
            method: "POST",
            body: JSON.stringify({ keepId: pKeepId, mergeId: pMergeId })
        }) as unknown as import('next/server').NextRequest;

        const res = await POST(req);
        expect(res.status).toBe(200);

        const data = await res.json();
        expect(data.success).toBe(true);

        // Verify data was moved
        const visits = await prisma.visit.findMany({ where: { personId: pKeepId } });
        expect(visits.length).toBe(1);

        // Verify kept user got merged user's phone
        const kept = await prisma.person.findUnique({ where: { id: pKeepId } });
        expect(kept?.phone).toBe("123-456-7890");

        // Verify merged user was tombstoned
        const merged = await prisma.person.findUnique({ where: { id: pMergeId } });
        expect(merged?.email).toContain("merged-");
        expect(merged?.email).toContain("@deleted.checkme.in");
        expect(merged?.phone).toBeNull();
    });

    it("should write an AuditLog row capturing the merge", async () => {
        await prisma.visit.create({
            data: { personId: pMergeId, arrivedAt: new Date() }
        });

        const req = new Request("http://localhost/api/membership-ops/participants/merge", {
            method: "POST",
            body: JSON.stringify({ keepId: pKeepId, mergeId: pMergeId })
        }) as unknown as import('next/server').NextRequest;

        const res = await POST(req);
        expect(res.status).toBe(200);

        const log = await prisma.auditLog.findFirst({
            where: { tableName: "Person", affectedEntityId: pKeepId, secondaryAffectedEntity: pMergeId }
        });
        expect(log).not.toBeNull();
        expect(log?.actorId).toBe(actorId);
        const newData = log?.newData as { keepId: number; moved: { visits: number } };
        expect(newData.keepId).toBe(pKeepId);
        expect(newData.moved.visits).toBe(1);

        // Full pre-image of the merged-away Person: every field the merge
        // rewrites (tombstone) or moves (backfill), captured before either update.
        const oldData = log?.oldData as Record<string, unknown>;
        expect(Object.keys(oldData).sort()).toEqual([
            "dateOfBirth", "email", "googleId", "householdId", "id", "image",
            "isHouseholdLead", "lastBackgroundCheck", "lastWaiverSign", "name", "phone",
        ].sort());
        expect(oldData.id).toBe(pMergeId);
        expect(oldData.email).toBe("merge@example.com");
        expect(oldData.phone).toBe("123-456-7890");
    });

    it("should succeed when the MERGED side holds googleId+email and the keeper holds neither (prod P2002 repro)", async () => {
        // This is the exact prod failure: the keeper backfill used to copy
        // googleId/email onto the keeper BEFORE the tombstone cleared them off
        // the merge-side row, tripping the @unique constraint and surfacing as
        // a generic 500. Reordering (tombstone first) fixes it.
        // Keeper starts with no email/googleId of its own (beforeEach gives it one
        // by default) so the backfill actually has something to copy.
        await prisma.person.update({
            where: { id: pKeepId },
            data: { email: null, googleId: null }
        });
        await prisma.person.update({
            where: { id: pMergeId },
            data: { googleId: "google-conflict-id", email: "conflict@example.com" }
        });

        const req = new Request("http://localhost/api/membership-ops/participants/merge", {
            method: "POST",
            body: JSON.stringify({ keepId: pKeepId, mergeId: pMergeId })
        }) as unknown as import('next/server').NextRequest;

        const res = await POST(req);
        const data = await res.json();
        if (res.status !== 200) console.error('Merge error:', data);
        expect(res.status).toBe(200);
        expect(data.success).toBe(true);

        const kept = await prisma.person.findUnique({ where: { id: pKeepId } });
        expect(kept?.googleId).toBe("google-conflict-id");
        expect(kept?.email).toBe("conflict@example.com");

        const merged = await prisma.person.findUnique({ where: { id: pMergeId } });
        expect(merged?.googleId).toBeNull();
        expect(merged?.email).toContain("merged-");
        expect(merged?.email).toContain("@deleted.checkme.in");
    });

    it("relinks one row and deletes the loser when keep AND merge both have a conflicting programParticipant + feePayment", async () => {
        // Both participants already enrolled in the SAME program and paying the SAME
        // fee → the merge can't relink (composite PK collision), so it must delete
        // the merge-side row and leave keep with exactly one of each.
        const program = await prisma.program.create({ data: { name: "Merge Conflict Program" } });
        createdProgramId = program.id;
        const fee = await prisma.fee.create({
            data: { programId: program.id, name: "Conflict Fee", nonOrgMemberPriceCents: 5000, orgMemberPriceCents: 2500 },
        });
        createdFeeId = fee.id;

        // SAME programId for both → programParticipant conflict.
        await prisma.programParticipant.create({ data: { programId: program.id, personId: pKeepId } });
        await prisma.programParticipant.create({ data: { programId: program.id, personId: pMergeId } });
        // SAME feeId for both → feePayment conflict.
        await prisma.feePayment.create({ data: { feeId: fee.id, personId: pKeepId } });
        await prisma.feePayment.create({ data: { feeId: fee.id, personId: pMergeId } });

        const req = new Request("http://localhost/api/membership-ops/participants/merge", {
            method: "POST",
            body: JSON.stringify({ keepId: pKeepId, mergeId: pMergeId })
        }) as unknown as import('next/server').NextRequest;

        const res = await POST(req);
        expect(res.status).toBe(200);

        // Keep retains exactly one of each — no duplicate, no double-count.
        const keepPPs = await prisma.programParticipant.findMany({ where: { personId: pKeepId, programId: program.id } });
        expect(keepPPs.length).toBe(1);
        const keepFPs = await prisma.feePayment.findMany({ where: { personId: pKeepId, feeId: fee.id } });
        expect(keepFPs.length).toBe(1);

        // The loser's rows were deleted (relink would have violated the composite PK).
        const mergePPCount = await prisma.programParticipant.count({ where: { personId: pMergeId } });
        expect(mergePPCount).toBe(0);
        const mergeFPCount = await prisma.feePayment.count({ where: { personId: pMergeId } });
        expect(mergeFPCount).toBe(0);

        // And exactly one of each exists overall for this program/fee (no orphan duplicates).
        expect(await prisma.programParticipant.count({ where: { programId: program.id } })).toBe(1);
        expect(await prisma.feePayment.count({ where: { feeId: fee.id } })).toBe(1);
    });

    it("should fail to merge if merged user is the lead of a household with other members", async () => {
        // Both users already share a household (from beforeEach); make merge user the lead
        await prisma.person.update({ where: { id: pMergeId }, data: { isHouseholdLead: true } });

        const req = new Request("http://localhost/api/membership-ops/participants/merge", {
            method: "POST",
            body: JSON.stringify({ keepId: pKeepId, mergeId: pMergeId })
        }) as unknown as import('next/server').NextRequest;

        const res = await POST(req);
        expect(res.status).toBe(400);

        const data = await res.json();
        expect(data.error).toContain("lead of a household with other members");
    });
});
