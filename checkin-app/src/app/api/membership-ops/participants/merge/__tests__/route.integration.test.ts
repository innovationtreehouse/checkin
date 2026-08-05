import { POST } from "../route";
import { GET as analyzeGET } from "../analyze/route";
import { GET as searchGET } from "@/app/api/people/search/route";
import { PATCH as settingsPATCH } from "@/app/api/programs/[id]/settings/route";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";

jest.mock("next-auth/next");
const mockGetServerSession = getServerSession as jest.Mock;

// runMatchAudit (matrix #17) gates on mirror.isConfigured() before touching the
// enrollment sweep this test cares about. The mirror itself (order-side) isn't
// what LIVE_PERSON changed, so it's stubbed to a trivial "configured, no orders"
// shape — real Prisma still runs the enrollment/membership queries against the
// live test DB, which is what actually proves the filter.
jest.mock("@/lib/shopifyRead/client", () => ({
    isConfigured: () => true,
    lineVariantStats: async () => ({ lines: 0, withVariant: 0 }),
    ordersForVariants: async () => [],
    orderLegacyIdsPresent: async () => new Set<string>(),
    ordersByLegacyIds: async () => [],
    minRealOrderLegacyId: async () => null,
}));
import { runMatchAudit } from "@/lib/finance/matchAudit";
import { orgMembershipStatusBlocksLogin } from "@/lib/orgMembership";
import type { OrgMembershipStatus } from "@/generated/prisma/client";

// Base fixture participants differ on name+email by design (realistic collision
// data for the field-picker tests below). name is a per-field conflict and both
// sides carry a login identity (an email), so a merge needs *some* resolution for
// both — default to "keep" for name and the identity unit; tests that specifically
// exercise fieldChoices validation pass their own map (including `{}` to
// deliberately hit the "missing choice" 400).
function mergeReq(keepId: number, mergeId: number, fieldChoices: Record<string, string> = { name: "keep", identity: "keep" }) {
    return new Request("http://localhost/api/membership-ops/participants/merge", {
        method: "POST",
        body: JSON.stringify({ keepId, mergeId, fieldChoices })
    }) as unknown as import("next/server").NextRequest;
}

function analyzeReq(a: number, b: number) {
    return new Request(`http://localhost/api/membership-ops/participants/merge/analyze?a=${a}&b=${b}`) as unknown as import("next/server").NextRequest;
}

describe("Merge Participants API", () => {
    let pKeepId: number;
    let pMergeId: number;
    let householdId: number;
    let actorId: number;
    // Extra rows/ids a given test creates beyond the base fixture — cleaned up
    // generically in afterEach so each test doesn't hand-roll teardown ordering.
    let extraPersonIds: number[];
    let extraHouseholdIds: number[];
    let createdProgramId: number | undefined;
    let createdToolId: number | undefined;
    let createdEventId: number | undefined;
    let createdCorporationId: number | undefined;
    let createdProcessIds: number[];

    beforeEach(async () => {
        const hh = await prisma.household.create({ data: { name: "Merge Test Household" } });
        householdId = hh.id;

        const actor = await prisma.person.create({
            data: { name: "Board Actor", email: "actor@example.com", householdId: hh.id, isBoardMember: true }
        });
        actorId = actor.id;

        mockGetServerSession.mockResolvedValue({
            user: { id: actorId, email: "actor@example.com", isBoardMember: true }
        });

        const pKeep = await prisma.person.create({
            data: { name: "Keep User", email: "keep@example.com", householdId: hh.id }
        });
        pKeepId = pKeep.id;

        const pMerge = await prisma.person.create({
            data: { name: "Merge User", email: "merge@example.com", phone: "123-456-7890", householdId: hh.id }
        });
        pMergeId = pMerge.id;

        extraPersonIds = [];
        extraHouseholdIds = [];
        createdProgramId = undefined;
        createdToolId = undefined;
        createdEventId = undefined;
        createdCorporationId = undefined;
        createdProcessIds = [];
    });

    /** A second household for the membership-guard tests; no OrgMembership row reads as NONE. */
    async function makeHousehold(name: string, status?: OrgMembershipStatus): Promise<number> {
        const hh = await prisma.household.create({ data: { name } });
        extraHouseholdIds.push(hh.id);
        if (status) await prisma.orgMembership.create({ data: { householdId: hh.id, status } });
        return hh.id;
    }

    afterEach(async () => {
        const personIds = [pKeepId, pMergeId, actorId, ...extraPersonIds];

        // RESTRICT-FK children must go before their Person rows.
        await prisma.backgroundCheckAttestation.deleteMany({ where: { reviewerId: { in: personIds } } });
        await prisma.corporationLead.deleteMany({ where: { personId: { in: personIds } } });
        await prisma.corporationMember.deleteMany({ where: { personId: { in: personIds } } });
        await prisma.trustedAdult.deleteMany({ where: { householdId } });
        await prisma.toolStatus.deleteMany({ where: { personId: { in: personIds } } });
        await prisma.rSVP.deleteMany({ where: { personId: { in: personIds } } });
        await prisma.visit.deleteMany({ where: { personId: { in: personIds } } });
        await prisma.programParticipant.deleteMany({ where: { personId: { in: personIds } } });
        await prisma.programVolunteer.deleteMany({ where: { personId: { in: personIds } } });
        await prisma.orgMembershipProcess.deleteMany({ where: { OR: [{ id: { in: createdProcessIds } }, { subjectPersonId: { in: personIds } }] } });
        await prisma.auditLog.deleteMany({ where: { actorId } });
        // Account/Session cascade-delete with their Person; no manual step needed.
        await prisma.person.deleteMany({ where: { id: { in: personIds } } });

        if (createdEventId) await prisma.event.deleteMany({ where: { id: createdEventId } });
        if (createdToolId) await prisma.tool.deleteMany({ where: { id: createdToolId } });
        if (createdProgramId) await prisma.program.deleteMany({ where: { id: createdProgramId } });
        if (createdCorporationId) await prisma.corporation.deleteMany({ where: { id: createdCorporationId } });
        await prisma.orgMembership.deleteMany({ where: { householdId: { in: [householdId, ...extraHouseholdIds] } } });
        if (householdId) await prisma.household.deleteMany({ where: { id: householdId } });
        if (extraHouseholdIds.length) await prisma.household.deleteMany({ where: { id: { in: extraHouseholdIds } } });
    });

    it("should successfully merge two participants", async () => {
        await prisma.visit.create({ data: { personId: pMergeId, arrivedAt: new Date() } });

        const res = await POST(mergeReq(pKeepId, pMergeId));
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);

        const visits = await prisma.visit.findMany({ where: { personId: pKeepId } });
        expect(visits.length).toBe(1);

        const kept = await prisma.person.findUnique({ where: { id: pKeepId } });
        expect(kept?.phone).toBe("123-456-7890");

        const merged = await prisma.person.findUnique({ where: { id: pMergeId } });
        expect(merged?.email).toContain("merged-");
        expect(merged?.email).toContain("@deleted.invalid");
        expect(merged?.phone).toBeNull();
        // decision 5: tombstone identity keeps its ORIGINAL name — no mangling.
        expect(merged?.name).toBe("Merge User");
        expect(merged?.mergedIntoId).toBe(pKeepId);
    });

    it("should write an AuditLog row capturing the merge (matrix 15)", async () => {
        await prisma.visit.create({ data: { personId: pMergeId, arrivedAt: new Date() } });

        const res = await POST(mergeReq(pKeepId, pMergeId));
        expect(res.status).toBe(200);

        const log = await prisma.auditLog.findFirst({
            where: { tableName: "Person", affectedEntityId: pKeepId, secondaryAffectedEntity: pMergeId }
        });
        expect(log).not.toBeNull();
        expect(log?.actorId).toBe(actorId);
        expect(log?.oldData).toMatchObject({ id: pMergeId, name: "Merge User", email: "merge@example.com" });
        const newData = log?.newData as { keepId: number; fieldChoices: Record<string, string>; moved: { visits: number; programParticipants: { migrated: number; left: number } } };
        expect(newData.keepId).toBe(pKeepId);
        expect(newData.fieldChoices).toEqual({ name: "keep", identity: "keep" });
        expect(newData.moved.visits).toBe(1);
        // Tallies use migrated/left, not the old `deleted` name.
        expect(newData.moved.programParticipants).toEqual({ migrated: 0, left: 0 });

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
            // name is a true conflict here (base fixture: "Keep User" vs "Merge
            // User") — the field-picker route 400s without an explicit choice.
            body: JSON.stringify({ keepId: pKeepId, mergeId: pMergeId, fieldChoices: { name: "keep" } })
        }) as unknown as import('next/server').NextRequest;

        const res = await POST(req);
        const data = await res.json();
        // Assert on the pair together so a failure's diff shows the response
        // body (was a console.error; folded into the assertion instead).
        expect({ status: res.status, data }).toEqual({ status: 200, data: { success: true } });

        const kept = await prisma.person.findUnique({ where: { id: pKeepId } });
        expect(kept?.googleId).toBe("google-conflict-id");
        expect(kept?.email).toBe("conflict@example.com");

        const merged = await prisma.person.findUnique({ where: { id: pMergeId } });
        expect(merged?.googleId).toBeNull();
        expect(merged?.email).toContain("merged-");
        expect(merged?.email).toContain("@deleted.invalid");
    });

    // Matrix 1: unique collision, both directions, across every loop-guarded relation.
    it("keeps BOTH rows on every join-table/loop-guarded collision — zero deletes", async () => {
        const program = await prisma.program.create({ data: { name: "Merge Conflict Program" } });
        createdProgramId = program.id;
        const tool = await prisma.tool.create({ data: { name: "Conflict Tool" } });
        createdToolId = tool.id;
        const event = await prisma.event.create({
            data: { programId: program.id, name: "Conflict Event", startAt: new Date(), endAt: new Date(Date.now() + 3600000) },
        });
        createdEventId = event.id;
        const corp = await prisma.corporation.create({ data: {} });
        createdCorporationId = corp.id;
        const process = await prisma.orgMembershipProcess.create({ data: { kind: "PERSON_BG", status: "PENDING_BG_REVIEW" } });
        createdProcessIds.push(process.id);

        // Collide on every relation that carries a unique/composite-PK constraint.
        await prisma.programParticipant.create({ data: { programId: program.id, personId: pKeepId } });
        await prisma.programParticipant.create({ data: { programId: program.id, personId: pMergeId } });
        await prisma.programVolunteer.create({ data: { programId: program.id, personId: pKeepId } });
        await prisma.programVolunteer.create({ data: { programId: program.id, personId: pMergeId } });
        await prisma.toolStatus.create({ data: { toolId: tool.id, personId: pKeepId, level: "BASIC" } });
        await prisma.toolStatus.create({ data: { toolId: tool.id, personId: pMergeId, level: "MAY_CERTIFY_OTHERS" } });
        await prisma.rSVP.create({ data: { eventId: event.id, personId: pKeepId, status: "ATTENDING" } });
        await prisma.rSVP.create({ data: { eventId: event.id, personId: pMergeId, status: "NOT_ATTENDING" } });
        await prisma.corporationLead.create({ data: { corporationId: corp.id, personId: pKeepId } });
        await prisma.corporationLead.create({ data: { corporationId: corp.id, personId: pMergeId } });
        await prisma.corporationMember.create({ data: { corporationId: corp.id, personId: pKeepId } });
        await prisma.corporationMember.create({ data: { corporationId: corp.id, personId: pMergeId } });
        await prisma.backgroundCheckAttestation.create({ data: { processId: process.id, reviewerId: pKeepId, result: "APPROVE" } });
        await prisma.backgroundCheckAttestation.create({ data: { processId: process.id, reviewerId: pMergeId, result: "REJECT" } });

        const res = await POST(mergeReq(pKeepId, pMergeId));
        expect(res.status).toBe(200);

        // Every collision retained BOTH rows — zero deletes.
        expect(await prisma.programParticipant.count({ where: { programId: program.id } })).toBe(2);
        expect(await prisma.programVolunteer.count({ where: { programId: program.id } })).toBe(2);
        expect(await prisma.toolStatus.count({ where: { toolId: tool.id } })).toBe(2);
        expect(await prisma.rSVP.count({ where: { eventId: event.id } })).toBe(2);
        expect(await prisma.corporationLead.count({ where: { corporationId: corp.id } })).toBe(2);
        expect(await prisma.corporationMember.count({ where: { corporationId: corp.id } })).toBe(2);
        expect(await prisma.backgroundCheckAttestation.count({ where: { processId: process.id } })).toBe(2);

        // The merge-side row is untouched (still personId === mergeId), not migrated.
        const mergePP = await prisma.programParticipant.findUnique({ where: { programId_personId: { programId: program.id, personId: pMergeId } } });
        expect(mergePP).not.toBeNull();
        const mergeAttestation = await prisma.backgroundCheckAttestation.findFirst({ where: { processId: process.id, reviewerId: pMergeId } });
        expect(mergeAttestation).not.toBeNull();

        // The LIVE count (§3) excludes the tombstone's collision row.
        const liveCount = await prisma.programParticipant.count({ where: { programId: program.id, person: { mergedIntoId: null } } });
        expect(liveCount).toBe(1);

        const log = await prisma.auditLog.findFirst({ where: { tableName: "Person", affectedEntityId: pKeepId, secondaryAffectedEntity: pMergeId } });
        const newData = log?.newData as { moved: Record<string, { migrated: number; left: number }> };
        expect(newData.moved.programParticipants).toEqual({ migrated: 0, left: 1 });
        expect(newData.moved.bgAttestations).toEqual({ migrated: 0, left: 1 });
        expect(newData.moved.corporationLeads).toEqual({ migrated: 0, left: 1 });
        expect(newData.moved.corporationMembers).toEqual({ migrated: 0, left: 1 });
    });

    // Matrix 2: non-collision move — the row relinks to the keeper, not duplicated.
    it("moves a tombstone-only enrollment/tool/rsvp to the keeper (no collision)", async () => {
        const program = await prisma.program.create({ data: { name: "Non-Collision Program" } });
        createdProgramId = program.id;
        const tool = await prisma.tool.create({ data: { name: "Tool" } });
        createdToolId = tool.id;
        const event = await prisma.event.create({
            data: { programId: program.id, name: "Event", startAt: new Date(), endAt: new Date(Date.now() + 3600000) },
        });
        createdEventId = event.id;

        // Only the MERGE side has these — nothing for the keeper to collide with.
        await prisma.programParticipant.create({ data: { programId: program.id, personId: pMergeId } });
        await prisma.toolStatus.create({ data: { toolId: tool.id, personId: pMergeId, level: "CERTIFIED" } });
        await prisma.rSVP.create({ data: { eventId: event.id, personId: pMergeId, status: "MAYBE" } });

        const res = await POST(mergeReq(pKeepId, pMergeId));
        expect(res.status).toBe(200);

        expect(await prisma.programParticipant.findUnique({ where: { programId_personId: { programId: program.id, personId: pKeepId } } })).not.toBeNull();
        expect(await prisma.programParticipant.findUnique({ where: { programId_personId: { programId: program.id, personId: pMergeId } } })).toBeNull();
        expect((await prisma.toolStatus.findUnique({ where: { personId_toolId: { personId: pKeepId, toolId: tool.id } } }))?.level).toBe("CERTIFIED");
        expect((await prisma.rSVP.findUnique({ where: { eventId_personId: { eventId: event.id, personId: pKeepId } } }))?.status).toBe("MAYBE");
    });

    it("should fail to merge if merged user is the lead of a household with other members", async () => {
        await prisma.person.update({ where: { id: pMergeId }, data: { isHouseholdLead: true } });

        const res = await POST(mergeReq(pKeepId, pMergeId));
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toContain("lead of a household with other members");
    });

    // The lead guard counts LIVE household members only: a tombstone left in the
    // household by an earlier merge is not another member.
    it("merges a household lead whose only other household row is a tombstone", async () => {
        const hh = await prisma.household.create({ data: { name: "Lead + Tombstone Household" } });
        extraHouseholdIds.push(hh.id);

        const lead = await prisma.person.create({
            data: { name: "Lead Person", householdId: hh.id, isHouseholdLead: true }
        });
        const ghost = await prisma.person.create({
            data: { name: "Already Merged", householdId: hh.id, mergedIntoId: pKeepId }
        });
        extraPersonIds.push(lead.id, ghost.id);

        // name is the only conflict — the lead carries no email/googleId, so the
        // keeper's identity is untouched and no `identity` choice is needed.
        const res = await POST(mergeReq(pKeepId, lead.id, { name: "keep" }));
        expect({ status: res.status, data: await res.json() }).toEqual({ status: 200, data: { success: true } });

        expect((await prisma.person.findUnique({ where: { id: lead.id } }))?.mergedIntoId).toBe(pKeepId);
        // ghost stays put — a tombstone is never cleaned up by a merge.
        expect((await prisma.person.findUnique({ where: { id: ghost.id } }))?.householdId).toBe(hh.id);
    });

    it("analyze omits a tombstoned household member from householdMembers", async () => {
        const hh = await prisma.household.create({ data: { name: "Analyze Tombstone Household" } });
        extraHouseholdIds.push(hh.id);

        const lead = await prisma.person.create({
            data: { name: "Analyze Lead", householdId: hh.id, isHouseholdLead: true }
        });
        const ghost = await prisma.person.create({
            data: { name: "Analyze Ghost", householdId: hh.id, mergedIntoId: pKeepId }
        });
        extraPersonIds.push(lead.id, ghost.id);

        const res = await analyzeGET(analyzeReq(pKeepId, lead.id));
        expect(res.status).toBe(200);
        const { participants } = await res.json();
        const members = participants[1].household.householdMembers as { id: number }[];
        expect(members.map(m => m.id)).toEqual([lead.id]);
    });

    // OrgMembership is 1:1 with Household and the merge never moves it: the tombstone
    // keeps its householdId, the keeper stays in its own household. Both resulting
    // harms depend on which side is merged away, so the guard is asymmetric.
    describe("household membership guard", () => {
        it("400s when the merged-away record is the last live member of an ACTIVE household (value stranded)", async () => {
            // Sole live member AND lead — the existing lead guard (lead + others > 0)
            // cannot see this shape.
            const memberHh = await makeHousehold("Paid Member Household", "ACTIVE");
            await prisma.person.update({ where: { id: pMergeId }, data: { householdId: memberHh, isHouseholdLead: true } });

            const res = await POST(mergeReq(pKeepId, pMergeId));
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toContain("last live member");
            expect(data.error).toContain("ACTIVE");

            // Refused before the transaction: the ACTIVE membership still has a live
            // member, and the surviving human isn't sitting in the NONE household.
            expect((await prisma.person.findUnique({ where: { id: pMergeId } }))?.mergedIntoId).toBeNull();
            expect(await prisma.person.count({ where: { householdId: memberHh, mergedIntoId: null } })).toBe(1);
        });

        it("400s on ACTIVE keeper vs ACTIVE merged-away when the merged-away side is its household's last live member", async () => {
            // Equal status on both sides, and still a stranding: the equality alone
            // says nothing about who is left to use the merged-away membership.
            await prisma.orgMembership.create({ data: { householdId, status: "ACTIVE" } });
            const otherActive = await makeHousehold("Other Active Household", "ACTIVE");
            await prisma.person.update({ where: { id: pMergeId }, data: { householdId: otherActive } });

            const res = await POST(mergeReq(pKeepId, pMergeId));
            expect(res.status).toBe(400);
            expect((await res.json()).error).toContain("last live member");
            expect((await prisma.person.findUnique({ where: { id: pMergeId } }))?.mergedIntoId).toBeNull();
        });

        it("counts only LIVE others: an ACTIVE household whose remaining members are all tombstones still blocks", async () => {
            const memberHh = await makeHousehold("Hollow Member Household", "ACTIVE");
            const alreadyMerged = await prisma.person.create({ data: { name: "Prior Tombstone", householdId: memberHh, mergedIntoId: pKeepId } });
            extraPersonIds.push(alreadyMerged.id);
            await prisma.person.update({ where: { id: pMergeId }, data: { householdId: memberHh } });

            const res = await POST(mergeReq(pKeepId, pMergeId));
            expect(res.status).toBe(400);
            expect((await res.json()).error).toContain("last live member");
        });

        it("allows an ACTIVE household merge when another live member remains", async () => {
            const memberHh = await makeHousehold("Shared Member Household", "ACTIVE");
            const sibling = await prisma.person.create({ data: { name: "Sibling", householdId: memberHh } });
            extraPersonIds.push(sibling.id);
            await prisma.person.update({ where: { id: pMergeId }, data: { householdId: memberHh } });

            const res = await POST(mergeReq(pKeepId, pMergeId));
            expect(res.status).toBe(200);
            expect((await prisma.person.findUnique({ where: { id: pMergeId } }))?.mergedIntoId).toBe(pKeepId);
        });

        it("400s when the merged-away record's household is DENIED and the keeper's is NONE (restriction laundered)", async () => {
            const deniedHh = await makeHousehold("Denied Household", "DENIED");
            await prisma.person.update({ where: { id: pMergeId }, data: { householdId: deniedHh } });

            const res = await POST(mergeReq(pKeepId, pMergeId));
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toContain("which restriction applies");
            expect(data.error).toContain("DENIED");

            // The login block is derived live from the person's household (authClaims),
            // so had the merge run, the surviving record would simply not be denied.
            const merged = await prisma.person.findUnique({ where: { id: pMergeId }, include: { household: { include: { orgMembership: true } } } });
            const kept = await prisma.person.findUnique({ where: { id: pKeepId }, include: { household: { include: { orgMembership: true } } } });
            expect(merged?.mergedIntoId).toBeNull();
            expect(orgMembershipStatusBlocksLogin(merged?.household?.orgMembership?.status)).toBe(true);
            expect(orgMembershipStatusBlocksLogin(kept?.household?.orgMembership?.status)).toBe(false);
        });

        it("400s when the KEEPER's household carries the restriction and the merged-away side is weaker", async () => {
            const revokedHh = await makeHousehold("Revoked Household", "REVOKED");
            await prisma.person.update({ where: { id: pKeepId }, data: { householdId: revokedHh } });
            const noneHh = await makeHousehold("Plain Household", "NONE");
            await prisma.person.update({ where: { id: pMergeId }, data: { householdId: noneHh } });

            const res = await POST(mergeReq(pKeepId, pMergeId));
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toContain("REVOKED");
            expect(data.error).toContain("which restriction applies");
        });

        it("allows two restricted households at the same status to merge", async () => {
            // Both on fresh households — the fixture's own household holds the board
            // actor, and a household containing a board member cannot be DENIED.
            const keepDenied = await makeHousehold("Keeper Denied Household", "DENIED");
            await prisma.person.update({ where: { id: pKeepId }, data: { householdId: keepDenied } });
            const otherDenied = await makeHousehold("Other Denied Household", "DENIED");
            await prisma.person.update({ where: { id: pMergeId }, data: { householdId: otherDenied } });

            // Nothing of value is stranded by a live-empty DENIED household, and the
            // survivor stays denied either way — no restriction changes hands.
            const res = await POST(mergeReq(pKeepId, pMergeId));
            expect(res.status).toBe(200);
        });

        // The archetypal dedupe: createParticipantWithHousehold gives every fresh
        // Google sign-in its own membership-less household and makes them its lead,
        // so the duplicate is NONE and its own sole member.
        it("allows the ordinary dedupe — ACTIVE keeper, duplicate alone in its own membership-less household", async () => {
            await prisma.orgMembership.create({ data: { householdId, status: "ACTIVE" } });
            const dupHh = await makeHousehold("Duplicate's Own Household");
            await prisma.person.update({ where: { id: pMergeId }, data: { householdId: dupHh, isHouseholdLead: true } });

            const res = await POST(mergeReq(pKeepId, pMergeId));
            expect(res.status).toBe(200);
            expect((await prisma.person.findUnique({ where: { id: pMergeId } }))?.mergedIntoId).toBe(pKeepId);
        });

        it("allows the merge when one household has an explicit NONE row and the other has no membership at all", async () => {
            const noneHh = await makeHousehold("Explicit None Household", "NONE");
            await prisma.person.update({ where: { id: pMergeId }, data: { householdId: noneHh } });

            const res = await POST(mergeReq(pKeepId, pMergeId));
            expect(res.status).toBe(200);
        });

        it("analyze reports the block per direction, so the picker can warn and point at the swap", async () => {
            // A alone in a NONE household, B alone in an ACTIVE one: merging B away
            // strands the membership, merging A away is the ordinary dedupe.
            const activeHh = await makeHousehold("Analyze Active Household", "ACTIVE");
            await prisma.person.update({ where: { id: pMergeId }, data: { householdId: activeHh } });

            const res = await analyzeGET(analyzeReq(pKeepId, pMergeId));
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.membershipBlock.aAsKeeper).toContain("last live member");
            expect(data.membershipBlock.bAsKeeper).toBeNull();

            // Back in one household, neither direction is blocked.
            await prisma.person.update({ where: { id: pMergeId }, data: { householdId } });
            const clean = await analyzeGET(analyzeReq(pKeepId, pMergeId));
            expect((await clean.json()).membershipBlock).toEqual({ aAsKeeper: null, bAsKeeper: null });
        });
    });

    // Matrix 4
    it("400s on self-merge", async () => {
        const res = await POST(mergeReq(pKeepId, pKeepId));
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBe("Invalid participant IDs provided.");
    });

    // Matrix 5
    it("409s on double-merge / merging a tombstone, both directions, and on analyze", async () => {
        const res1 = await POST(mergeReq(pKeepId, pMergeId));
        expect(res1.status).toBe(200);

        // Third participant to attempt merging with the now-tombstoned pMergeId.
        const third = await prisma.person.create({ data: { name: "Third", householdId } });
        extraPersonIds.push(third.id);

        const asMergeId = await POST(mergeReq(third.id, pMergeId));
        expect(asMergeId.status).toBe(409);

        const asKeepId = await POST(mergeReq(pMergeId, third.id));
        expect(asKeepId.status).toBe(409);

        const analyzeRes = await analyzeGET(analyzeReq(pMergeId, third.id));
        expect(analyzeRes.status).toBe(409);
    });

    it("analyze projects only what the merge picker reads — no raw Person/Household rows", async () => {
        // The fixture must actually SET the sensitive fields, or the negative
        // assertions below pass vacuously and pin nothing.
        await prisma.household.update({
            where: { id: householdId },
            data: { intakeNotes: "family notes, not for the merge screen", line1: "1 Secret Ln" }
        });
        await prisma.person.update({
            where: { id: pKeepId },
            data: { allergies: "peanuts", googleId: "google-keep-1", dateOfBirth: new Date("2001-02-03") }
        });
        await prisma.person.update({
            where: { id: pMergeId },
            data: { allergies: "latex", googleId: "google-merge-2", dateOfBirth: new Date("2002-03-04") }
        });
        await prisma.visit.create({ data: { personId: pKeepId, arrivedAt: new Date() } });

        const res = await analyzeGET(analyzeReq(pKeepId, pMergeId));
        expect(res.status).toBe(200);
        const { participants } = await res.json();
        const hit = participants[0];
        expect(hit.id).toBe(pKeepId);

        // Stripped: nothing on this screen reads any of these.
        expect(hit.allergies).toBeUndefined();
        expect(hit.notificationSettings).toBeUndefined();
        expect(hit.lastBackgroundCheck).toBeUndefined();
        expect(hit.household.intakeNotes).toBeUndefined();
        expect(hit.household.line1).toBeUndefined();
        const member = hit.household.householdMembers.find((m: { id: number }) => m.id === pMergeId);
        expect(member.googleId).toBeUndefined();
        expect(member.dateOfBirth).toBeUndefined();
        expect(member.email).toBeUndefined();
        expect(member.allergies).toBeUndefined();

        // Surviving: the conflict picker's inputs and the keep/merge score.
        expect(hit.googleId).toBe("google-keep-1");
        expect(hit.dateOfBirth).toBeTruthy();
        expect(hit.name).toBe("Keep User");
        expect(hit.email).toBe("keep@example.com");
        expect(member).toHaveProperty("isHouseholdLead");
        expect(member.name).toBe("Merge User");
        expect(hit.household.name).toBe("Merge Test Household");
        expect(hit._count.visits).toBe(1);
        expect(hit._count.programParticipants).toBe(0);
    });

    // Matrix 6
    it("concurrent double-merge: exactly one CAS wins, the other 409s and rolls back", async () => {
        const keep2 = await prisma.person.create({ data: { name: "Keep Two", householdId } });
        extraPersonIds.push(keep2.id);

        const [resA, resB] = await Promise.all([
            POST(mergeReq(pKeepId, pMergeId)),
            POST(mergeReq(keep2.id, pMergeId)),
        ]);

        const statuses = [resA.status, resB.status].sort();
        expect(statuses).toEqual([200, 409]);

        const tombstone = await prisma.person.findUnique({ where: { id: pMergeId } });
        const winnerId = resA.status === 200 ? pKeepId : keep2.id;
        expect(tombstone?.mergedIntoId).toBe(winnerId);
    });

    // Matrix 7
    it("merge chain A→B→C: provenance and moved rows both follow to the terminal record", async () => {
        const c = await prisma.person.create({ data: { name: "Terminal C", householdId } });
        extraPersonIds.push(c.id);

        await prisma.visit.create({ data: { personId: pMergeId, arrivedAt: new Date(Date.now() - 86400000), departedAt: new Date(Date.now() - 80000000) } });

        // A (pMergeId) merges into B (pKeepId).
        const res1 = await POST(mergeReq(pKeepId, pMergeId));
        expect(res1.status).toBe(200);

        // B (pKeepId) merges into C.
        const res2 = await POST(mergeReq(c.id, pKeepId));
        expect(res2.status).toBe(200);

        const a = await prisma.person.findUnique({ where: { id: pMergeId } });
        const b = await prisma.person.findUnique({ where: { id: pKeepId } });
        expect(a?.mergedIntoId).toBe(pKeepId);
        expect(b?.mergedIntoId).toBe(c.id);

        // A's visit moved to B on the first merge, then on to C on the second.
        const visitsOnC = await prisma.visit.findMany({ where: { personId: c.id } });
        expect(visitsOnC.length).toBe(1);
        expect(await prisma.visit.count({ where: { personId: pMergeId } })).toBe(0);
        expect(await prisma.visit.count({ where: { personId: pKeepId } })).toBe(0);
    });

    // Matrix 8
    describe("fieldChoices validation", () => {
        it("400s on an unknown field key", async () => {
            const res = await POST(mergeReq(pKeepId, pMergeId, { notAField: "keep" }));
            expect(res.status).toBe(400);
        });

        it("400s on an invalid choice value", async () => {
            const res = await POST(mergeReq(pKeepId, pMergeId, { phone: "x" }));
            expect(res.status).toBe(400);
        });

        it("400s when a true conflict has no choice", async () => {
            // name differs and is non-null on both sides ("Keep User" vs "Merge User").
            const res = await POST(mergeReq(pKeepId, pMergeId, {}));
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toContain("name");
        });

        it("identity 'merge' adopts the tombstone's email with no P2002 (clear-first ordering proven)", async () => {
            const res = await POST(mergeReq(pKeepId, pMergeId, { name: "keep", identity: "merge" }));
            expect(res.status).toBe(200);
            const kept = await prisma.person.findUnique({ where: { id: pKeepId } });
            expect(kept?.email).toBe("merge@example.com");
        });

        it("identity 'keep' leaves the keeper's value", async () => {
            const res = await POST(mergeReq(pKeepId, pMergeId, { name: "keep", identity: "keep" }));
            expect(res.status).toBe(200);
            const kept = await prisma.person.findUnique({ where: { id: pKeepId } });
            expect(kept?.email).toBe("keep@example.com");
            expect(kept?.name).toBe("Keep User");
        });
    });

    // #1225 failure #2: emailSuppressed is an opt-out tied to a specific address.
    // The login identity resolves as one unit, so suppression must ride with
    // whichever side's address wins — not stay stuck on the keeper's own.
    it("carries emailSuppressed with the identity when 'merge' wins", async () => {
        await prisma.person.update({ where: { id: pKeepId }, data: { emailSuppressed: false } });
        await prisma.person.update({ where: { id: pMergeId }, data: { emailSuppressed: true } });

        const res = await POST(mergeReq(pKeepId, pMergeId, { name: "keep", identity: "merge" }));
        expect(res.status).toBe(200);
        const kept = await prisma.person.findUnique({ where: { id: pKeepId } });
        expect(kept?.email).toBe("merge@example.com");
        expect(kept?.emailSuppressed).toBe(true); // opt-out rode in with address B
    });

    it("backfills emailSuppressed with the identity when the keeper had no identity of its own", async () => {
        await prisma.person.update({ where: { id: pKeepId }, data: { email: null, emailSuppressed: false } });
        await prisma.person.update({ where: { id: pMergeId }, data: { emailSuppressed: true } });

        // name is the base-fixture conflict; the merge-side identity is backfilled
        // (keeper empty), so no `identity` radio is needed.
        const res = await POST(mergeReq(pKeepId, pMergeId, { name: "keep" }));
        expect(res.status).toBe(200);
        const kept = await prisma.person.findUnique({ where: { id: pKeepId } });
        expect(kept?.email).toBe("merge@example.com");
        expect(kept?.emailSuppressed).toBe(true);
    });

    // Matrix 9 — the login identity (email+googleId+emailVerified) resolves as ONE
    // unit, so a merge can never strand it: picking either side keeps a whole,
    // self-consistent identity. This proves it on the most adversarial shape — both
    // sides carry a full email+googleId — where the OLD per-field design could have
    // spliced keeper-email onto merge-googleId. Now `identity: "merge"` adopts the
    // merge side wholesale.
    it("does not strand the login identity on a full email+googleId conflict", async () => {
        await prisma.person.update({ where: { id: pKeepId }, data: { googleId: "g-keep" } });
        await prisma.person.update({ where: { id: pMergeId }, data: { googleId: "g-merge" } });
        const res = await POST(mergeReq(pKeepId, pMergeId, { name: "keep", identity: "merge" }));
        expect(res.status).toBe(200);
        const kept = await prisma.person.findUnique({ where: { id: pKeepId } });
        expect(kept?.email).toBe("merge@example.com");
        expect(kept?.googleId).toBe("g-merge");
    });

    // #1225 identity-unit: email/googleId/emailVerified resolve together, never split.
    describe("login identity resolves as one unit (#1225)", () => {
        it("both sides Google, identity 'merge': keeper takes merge's email+googleId+emailVerified together, no cross-side split", async () => {
            const keepVerified = new Date("2026-01-01");
            const mergeVerified = new Date("2026-05-05");
            await prisma.person.update({ where: { id: pKeepId }, data: { googleId: "g-keep", emailVerified: keepVerified } });
            await prisma.person.update({ where: { id: pMergeId }, data: { googleId: "g-merge", emailVerified: mergeVerified } });

            const res = await POST(mergeReq(pKeepId, pMergeId, { name: "keep", identity: "merge" }));
            expect(res.status).toBe(200);

            const kept = await prisma.person.findUnique({ where: { id: pKeepId } });
            // Every identity field came from the merge side — no field left over from the keeper.
            expect(kept?.email).toBe("merge@example.com");
            expect(kept?.googleId).toBe("g-merge");
            expect(kept?.emailVerified?.getTime()).toBe(mergeVerified.getTime());
            // The stale keeper stamp must NOT ride along on the swapped-in address.
            expect(kept?.emailVerified?.getTime()).not.toBe(keepVerified.getTime());

            // Tombstone carries no verified stamp for the sentinel address.
            const tomb = await prisma.person.findUnique({ where: { id: pMergeId } });
            expect(tomb?.emailVerified).toBeNull();
        });

        it("magic-link keeper (email, no googleId) + Google merge, identity 'merge': all three move as a unit", async () => {
            const mergeVerified = new Date("2026-06-06");
            // keeper: magic-link/imported — email + emailVerified, NO googleId.
            await prisma.person.update({ where: { id: pKeepId }, data: { googleId: null, emailVerified: new Date("2026-02-02") } });
            await prisma.person.update({ where: { id: pMergeId }, data: { googleId: "g-merge", emailVerified: mergeVerified } });

            const res = await POST(mergeReq(pKeepId, pMergeId, { name: "keep", identity: "merge" }));
            expect(res.status).toBe(200);

            const kept = await prisma.person.findUnique({ where: { id: pKeepId } });
            expect(kept?.email).toBe("merge@example.com");
            expect(kept?.googleId).toBe("g-merge");
            expect(kept?.emailVerified?.getTime()).toBe(mergeVerified.getTime());
        });

        it("one-sided: empty keeper auto-adopts the merge side's email+googleId+emailVerified as a unit", async () => {
            const mergeVerified = new Date("2026-07-07");
            await prisma.person.update({ where: { id: pKeepId }, data: { email: null, googleId: null, emailVerified: null } });
            await prisma.person.update({ where: { id: pMergeId }, data: { googleId: "g-merge", emailVerified: mergeVerified } });

            // No identity choice needed (keeper has none); name is still a conflict.
            const res = await POST(mergeReq(pKeepId, pMergeId, { name: "keep" }));
            expect(res.status).toBe(200);

            const kept = await prisma.person.findUnique({ where: { id: pKeepId } });
            expect(kept?.email).toBe("merge@example.com");
            expect(kept?.googleId).toBe("g-merge");
            expect(kept?.emailVerified?.getTime()).toBe(mergeVerified.getTime());
        });

        it("400s when both sides have a login identity but fieldChoices.identity is missing", async () => {
            // Base fixture: keeper and merge both have an email — an unavoidable identity conflict.
            const res = await POST(mergeReq(pKeepId, pMergeId, { name: "keep" }));
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toContain("identity");
        });
    });

    // Matrix 10
    it("auto-picks the newer lastBackgroundCheck/lastWaiverSign date (merge side newer)", async () => {
        const older = new Date("2026-01-01");
        const newer = new Date("2026-06-01");
        await prisma.person.update({ where: { id: pKeepId }, data: { lastBackgroundCheck: older, name: "Keep User" } });
        await prisma.person.update({ where: { id: pMergeId }, data: { lastBackgroundCheck: newer, name: "Keep User" } });

        const res = await POST(mergeReq(pKeepId, pMergeId));
        expect(res.status).toBe(200);
        const kept = await prisma.person.findUnique({ where: { id: pKeepId } });
        expect(kept?.lastBackgroundCheck?.getTime()).toBe(newer.getTime());
    });

    it("auto-picks the newer lastBackgroundCheck/lastWaiverSign date (keep side newer)", async () => {
        const older = new Date("2026-01-01");
        const newer = new Date("2026-06-01");
        await prisma.person.update({ where: { id: pKeepId }, data: { lastWaiverSign: newer, name: "Keep User" } });
        await prisma.person.update({ where: { id: pMergeId }, data: { lastWaiverSign: older, name: "Keep User" } });

        const res = await POST(mergeReq(pKeepId, pMergeId));
        expect(res.status).toBe(200);
        const kept = await prisma.person.findUnique({ where: { id: pKeepId } });
        expect(kept?.lastWaiverSign?.getTime()).toBe(newer.getTime());
    });

    // Matrix 11
    it("single-sided auto-backfill: keeper null, tombstone set -> keeper backfilled", async () => {
        const kA = await prisma.person.create({ data: { name: null, phone: null, dateOfBirth: null, image: null, googleId: null, email: null, householdId } });
        const kB = await prisma.person.create({
            data: {
                name: "Backfill Source", phone: "555-0100", dateOfBirth: new Date("1990-01-01"),
                image: "https://example.com/a.png", googleId: "g-backfill", email: "backfill@example.com", householdId,
            }
        });
        extraPersonIds.push(kA.id, kB.id);

        const res = await POST(mergeReq(kA.id, kB.id));
        expect(res.status).toBe(200);
        const kept = await prisma.person.findUnique({ where: { id: kA.id } });
        expect(kept?.name).toBe("Backfill Source");
        expect(kept?.phone).toBe("555-0100");
        expect(kept?.dateOfBirth?.toISOString()).toBe(new Date("1990-01-01").toISOString());
        expect(kept?.image).toBe("https://example.com/a.png");
        expect(kept?.googleId).toBe("g-backfill");
        expect(kept?.email).toBe("backfill@example.com");
    });

    // Matrix 12
    it("zero-rows-deleted invariant across every join table + moved relation", async () => {
        const program = await prisma.program.create({ data: { name: "Invariant Program", leadMentorId: pMergeId } });
        createdProgramId = program.id;
        const corp = await prisma.corporation.create({ data: {} });
        createdCorporationId = corp.id;
        const process = await prisma.orgMembershipProcess.create({ data: { kind: "PERSON_BG", status: "PENDING_BG_REVIEW" } });
        createdProcessIds.push(process.id);
        const bgProcess = await prisma.orgMembershipProcess.create({ data: { kind: "PERSON_BG", status: "PENDING_BG_REVIEW", subjectPersonId: pMergeId } });
        createdProcessIds.push(bgProcess.id);

        await prisma.account.create({ data: { userId: pMergeId, type: "oauth", provider: "google", providerAccountId: "acct-invariant-1" } });
        await prisma.session.create({ data: { userId: pMergeId, sessionToken: "sess-invariant-1", expires: new Date(Date.now() + 86400000) } });
        await prisma.backgroundCheckAttestation.create({ data: { processId: process.id, reviewerId: pMergeId, result: "APPROVE" } });
        await prisma.corporationLead.create({ data: { corporationId: corp.id, personId: pMergeId } });
        await prisma.corporationMember.create({ data: { corporationId: corp.id, personId: pMergeId } });
        await prisma.trustedAdult.create({
            data: { householdId, trustedAdultPersonId: pMergeId, trustedAdultName: "Adult A", trustedAdultPhone: "555-0111", disclosedById: actorId, familyContext: "context" }
        });
        await prisma.trustedAdult.create({
            data: { householdId, trustedAdultName: "Adult B", trustedAdultPhone: "555-0112", disclosedById: pMergeId, familyContext: "context" }
        });
        await prisma.visit.create({ data: { personId: pMergeId, arrivedAt: new Date(Date.now() - 3600000), departedAt: new Date() } });

        // Session is deliberately excluded from this invariant: it's the one
        // relation the merge deletes rather than moves (see route.ts step 5) —
        // asserted separately below.
        const countAll = async () => ({
            account: await prisma.account.count({ where: { userId: { in: [pKeepId, pMergeId] } } }),
            bgAttestation: await prisma.backgroundCheckAttestation.count({ where: { reviewerId: { in: [pKeepId, pMergeId] } } }),
            corporationLead: await prisma.corporationLead.count({ where: { personId: { in: [pKeepId, pMergeId] } } }),
            corporationMember: await prisma.corporationMember.count({ where: { personId: { in: [pKeepId, pMergeId] } } }),
            orgMembershipProcess: await prisma.orgMembershipProcess.count({ where: { subjectPersonId: { in: [pKeepId, pMergeId] } } }),
            program: await prisma.program.count({ where: { leadMentorId: { in: [pKeepId, pMergeId] } } }),
            trustedAdult: await prisma.trustedAdult.count({ where: { OR: [{ trustedAdultPersonId: { in: [pKeepId, pMergeId] } }, { disclosedById: { in: [pKeepId, pMergeId] } }] } }),
            visit: await prisma.visit.count({ where: { personId: { in: [pKeepId, pMergeId] } } }),
        });

        const before = await countAll();
        const res = await POST(mergeReq(pKeepId, pMergeId));
        expect(res.status).toBe(200);
        const after = await countAll();

        expect(after).toEqual(before);

        // Sessions are the deliberate exception: deleted, not moved — no reason to
        // inherit a login session, and forcing re-login is smaller and safer.
        expect(await prisma.session.count({ where: { userId: { in: [pKeepId, pMergeId] } } })).toBe(0);
    });

    // One human owes ONE background check: both sides can hold an open PERSON_BG, and
    // re-pointing both at the survivor would leave two concurrent 2-of-N reviews.
    describe("duplicate open PERSON_BG on both merge subjects", () => {
        const openPersonBg = (personId: number, extra: { status?: "PENDING_BG_REVIEW" | "BLOCKED"; bgConsentAt?: Date } = {}) =>
            prisma.orgMembershipProcess.create({
                data: { kind: "PERSON_BG", subjectPersonId: personId, status: extra.status ?? "PENDING_BG_REVIEW", bgConsentAt: extra.bgConsentAt ?? null },
            });

        const openForKeeper = () =>
            prisma.orgMembershipProcess.findMany({
                where: { kind: "PERSON_BG", subjectPersonId: pKeepId, status: { in: ["PENDING_BG_REVIEW", "BLOCKED"] } },
            });

        it("leaves the survivor exactly one open PERSON_BG, archiving the less-advanced row", async () => {
            const keeperProc = await openPersonBg(pKeepId);
            const tombstoneProc = await openPersonBg(pMergeId, { bgConsentAt: new Date() }); // further along: submitted for review
            createdProcessIds.push(keeperProc.id, tombstoneProc.id);

            const res = await POST(mergeReq(pKeepId, pMergeId));
            expect(res.status).toBe(200);

            const open = await openForKeeper();
            expect(open.map(p => p.id)).toEqual([tombstoneProc.id]);

            // The loser is ARCHIVED (not deleted), with archiveApplication's audit shape
            // so the board can unarchive it if the merge picked wrong.
            const loser = await prisma.orgMembershipProcess.findUnique({ where: { id: keeperProc.id } });
            expect(loser?.status).toBe("ARCHIVED");
            expect(loser?.subjectPersonId).toBe(pKeepId);
            const log = await prisma.auditLog.findFirst({ where: { tableName: "OrgMembershipProcess", affectedEntityId: keeperProc.id } });
            expect(log?.oldData).toMatchObject({ status: "PENDING_BG_REVIEW" });
            expect(log?.newData).toMatchObject({ status: "ARCHIVED", survivorProcessId: tombstoneProc.id });

            const mergeLog = await prisma.auditLog.findFirst({ where: { tableName: "Person", affectedEntityId: pKeepId, secondaryAffectedEntity: pMergeId } });
            expect((mergeLog?.newData as { moved: { personBgArchived: number } }).moved.personBgArchived).toBe(1);
        });

        it("keeps the row with attestations when neither has consent", async () => {
            const keeperProc = await openPersonBg(pKeepId);
            const tombstoneProc = await openPersonBg(pMergeId);
            createdProcessIds.push(keeperProc.id, tombstoneProc.id);
            await prisma.backgroundCheckAttestation.create({ data: { processId: keeperProc.id, reviewerId: actorId, result: "APPROVE" } });

            const res = await POST(mergeReq(pKeepId, pMergeId));
            expect(res.status).toBe(200);

            const open = await openForKeeper();
            expect(open.map(p => p.id)).toEqual([keeperProc.id]);
            // The reviewer's work is not orphaned onto the archived row.
            expect(await prisma.backgroundCheckAttestation.count({ where: { processId: keeperProc.id } })).toBe(1);
        });

        it("never archives a BLOCKED row in favour of an open review", async () => {
            const keeperProc = await openPersonBg(pKeepId, { bgConsentAt: new Date() });
            const tombstoneProc = await openPersonBg(pMergeId, { status: "BLOCKED" });
            createdProcessIds.push(keeperProc.id, tombstoneProc.id);

            const res = await POST(mergeReq(pKeepId, pMergeId));
            expect(res.status).toBe(200);

            const open = await openForKeeper();
            // The rejection survives; the pending review is the one archived.
            expect(open.map(p => p.id)).toEqual([tombstoneProc.id]);
            expect((await prisma.orgMembershipProcess.findUnique({ where: { id: keeperProc.id } }))?.status).toBe("ARCHIVED");
        });

        it("leaves a single open PERSON_BG alone (nothing to resolve)", async () => {
            const tombstoneProc = await openPersonBg(pMergeId);
            createdProcessIds.push(tombstoneProc.id);

            const res = await POST(mergeReq(pKeepId, pMergeId));
            expect(res.status).toBe(200);

            const open = await openForKeeper();
            expect(open.map(p => ({ id: p.id, status: p.status }))).toEqual([{ id: tombstoneProc.id, status: "PENDING_BG_REVIEW" }]);
        });
    });

    // Matrix 13
    it("moves closed visits; both-open leaves the tombstone's open visit in place", async () => {
        await prisma.visit.create({ data: { personId: pKeepId, arrivedAt: new Date(Date.now() - 3600000) } }); // keeper's own open visit
        await prisma.visit.create({ data: { personId: pMergeId, arrivedAt: new Date(Date.now() - 7200000) } }); // tombstone's open visit
        await prisma.visit.create({ data: { personId: pMergeId, arrivedAt: new Date(Date.now() - 10800000), departedAt: new Date(Date.now() - 9800000) } }); // tombstone's closed visit

        const res = await POST(mergeReq(pKeepId, pMergeId));
        expect(res.status).toBe(200);

        const keeperVisits = await prisma.visit.findMany({ where: { personId: pKeepId } });
        expect(keeperVisits.length).toBe(2); // its own open + the moved closed one
        expect(keeperVisits.filter(v => v.departedAt === null).length).toBe(1); // still exactly one open

        const tombstoneVisits = await prisma.visit.findMany({ where: { personId: pMergeId } });
        expect(tombstoneVisits.length).toBe(1);
        expect(tombstoneVisits[0].departedAt).toBeNull(); // its own open visit, untouched
    });

    // Matrix 14
    it("accounts move: login-follows-survivor via the same query the NextAuth adapter uses", async () => {
        await prisma.account.create({ data: { userId: pMergeId, type: "oauth", provider: "google", providerAccountId: "acct-login-follow" } });

        const res = await POST(mergeReq(pKeepId, pMergeId));
        expect(res.status).toBe(200);

        // getUserByAccount's exact query shape (auth-options.ts:103-108).
        const account = await prisma.account.findUnique({
            where: { provider_providerAccountId: { provider: "google", providerAccountId: "acct-login-follow" } },
            include: { user: true },
        });
        expect(account?.user?.id).toBe(pKeepId);

        // getUserByEmail's exact query shape (auth-options.ts:98-100) — placeholder, resolves nobody.
        const byOriginalEmail = await prisma.person.findUnique({ where: { email: "merge@example.com" } });
        expect(byOriginalEmail).toBeNull();
    });

    // Matrix 16 (representative subset — see final report for scope note)
    describe("consumer exclusion (§3 LIVE_PERSON)", () => {
        it("people/search omits a merged-away tombstone even when the query matches its (unchanged) name", async () => {
            const res = await POST(mergeReq(pKeepId, pMergeId));
            expect(res.status).toBe(200);

            mockGetServerSession.mockResolvedValue({ user: { id: actorId, isBoardMember: true } });
            const searchRes = await searchGET(new Request(`http://localhost/api/people/search?q=${encodeURIComponent("Merge User")}`) as unknown as import("next/server").NextRequest);
            expect(searchRes.status).toBe(200);
            const data = await searchRes.json();
            expect((data.people as { id: number }[]).some(p => p.id === pMergeId)).toBe(false);
        });

        it("the enrollment cap gate ignores a tombstone's collision seat", async () => {
            const program = await prisma.program.create({ data: { name: "Cap Gate Program", maxParticipants: 5 } });
            createdProgramId = program.id;
            await prisma.programParticipant.create({ data: { programId: program.id, personId: pKeepId } });
            await prisma.programParticipant.create({ data: { programId: program.id, personId: pMergeId } });

            const res = await POST(mergeReq(pKeepId, pMergeId));
            expect(res.status).toBe(200);
            // Two rows physically remain (collision, no-delete), but only one is LIVE.
            // Setting the cap to 1 must succeed — a count that still saw the tombstone's
            // seat would reject this as "below current enrollment of 2".
            const patchRes = await settingsPATCH(
                new Request(`http://localhost/api/programs/${program.id}/settings`, {
                    method: "PATCH",
                    body: JSON.stringify({ maxParticipants: 1 }),
                }) as unknown as import("next/server").NextRequest,
                { params: Promise.resolve({ id: String(program.id) }) },
            );
            expect(patchRes.status).toBe(200);
        });
    });

    // Matrix 17
    it("match-audit: an ACTIVE payment-bearing enrollment left on a tombstone is excluded from the sweep", async () => {
        const program = await prisma.program.create({ data: { name: "Match Audit Program", shopifyVariantId: "variant-match-audit" } });
        createdProgramId = program.id;
        // Collision so the merge-side row is LEFT on the tombstone (not moved).
        await prisma.programParticipant.create({ data: { programId: program.id, personId: pKeepId, status: "ACTIVE" } });
        await prisma.programParticipant.create({ data: { programId: program.id, personId: pMergeId, status: "ACTIVE" } });

        const res = await POST(mergeReq(pKeepId, pMergeId));
        expect(res.status).toBe(200);

        const result = await runMatchAudit();
        expect(result.enrollments.some(e => e.personId === pMergeId)).toBe(false);
        expect(result.enrollments.some(e => e.personId === pKeepId && e.programId === program.id)).toBe(true);
    });
});
