/**
 * @jest-environment node
 */
/**
 * Integration tests for the time-scoped lead emergency-contact view
 * (GET /api/my-programs/programs/[programId]/emergency-contacts).
 * See docs/designs/LEAD_EMERGENCY_CONTACT_ACCESS.md.
 *
 * Matrix: lead in-window sees ONLY the program's roster households' contacts;
 * out-of-window → 403; null dates → 403 (fail closed); off-roster/non-lead → 403;
 * board unaffected (their /safety route still serves); one audit row per household
 * per view (not per contact).
 */

import { GET as EC } from "@/app/api/my-programs/programs/[programId]/emergency-contacts/route";
import { GET as SAFETY } from "@/app/api/safety/emergency-contacts/route";
import prisma from "@/lib/prisma";
import { LEAD_EC_ACCESS_BUFFER_DAYS } from "@/lib/emergencyContacts/leadAccess";
import { getServerSession } from "next-auth/next";

jest.mock("next-auth/next", () => ({ getServerSession: jest.fn() }));
jest.mock("@/lib/email", () => ({ sendEmail: jest.fn().mockResolvedValue(true) }));

const TAG = "lead-ec-access-test";
const DAY = 86_400_000;

function as(id: number, householdId: number, roles: { isBoardMember?: boolean; isSysadmin?: boolean; isKeyholder?: boolean } = {}) {
    (getServerSession as jest.Mock).mockResolvedValue({
        user: { id, householdId, isSysadmin: false, isBoardMember: false, isKeyholder: false, isBackgroundCheckReviewer: false, ...roles },
    });
}
function get(url: string) {
    return new Request(`http://localhost:4000${url}`) as never;
}
const ctx = (programId: number) => ({ params: Promise.resolve({ programId: String(programId) }) });
async function ec(programId: number) {
    return EC(get(`/api/my-programs/programs/${programId}/emergency-contacts`), ctx(programId));
}

async function makeHousehold(label: string, contacts: { name: string; phone: string }[]) {
    const hh = await prisma.household.create({ data: { name: `${label} ${TAG}` } });
    const child = await prisma.person.create({ data: { name: `${label} child`, householdId: hh.id } });
    for (const c of contacts) {
        await prisma.emergencyContact.create({
            data: { householdId: hh.id, name: c.name, phone: c.phone, phoneDigits: c.phone.replace(/\D/g, ""), priority: 0 },
        });
    }
    return { hhId: hh.id, childId: child.id };
}

describe("Lead emergency-contact access (time-scoped)", () => {
    const now = Date.now();
    let leadId = 0, leadHh = 0, boardId = 0, boardHh = 0, otherLeadId = 0, otherLeadHh = 0;
    let inWindowProg = 0, outWindowProg = 0, nullDatesProg = 0, otherProg = 0, auditProg = 0;
    let hhA = 0, hhB = 0, hhD = 0, hhAudit = 0;

    async function wipe() {
        const hhs = await prisma.household.findMany({ where: { name: { contains: TAG } }, select: { id: true } });
        const ids = hhs.map(h => h.id);
        if (ids.length) {
            const people = await prisma.person.findMany({ where: { householdId: { in: ids } }, select: { id: true } });
            await prisma.programParticipant.deleteMany({ where: { personId: { in: people.map(p => p.id) } } });
            await prisma.program.deleteMany({ where: { name: { contains: TAG } } });
            await prisma.auditLog.deleteMany({ where: { tableName: "EmergencyContact", action: "READ", affectedEntityId: { in: ids } } });
            await prisma.person.deleteMany({ where: { householdId: { in: ids } } });
            await prisma.household.deleteMany({ where: { id: { in: ids } } }); // cascades emergencyContacts
        }
    }

    beforeAll(async () => {
        await wipe();
        leadHh = (await prisma.household.create({ data: { name: `Lead HH ${TAG}` } })).id;
        leadId = (await prisma.person.create({ data: { name: "Lead", householdId: leadHh } })).id;
        boardHh = (await prisma.household.create({ data: { name: `Board HH ${TAG}` } })).id;
        boardId = (await prisma.person.create({ data: { name: "Board", isBoardMember: true, householdId: boardHh } })).id;
        otherLeadHh = (await prisma.household.create({ data: { name: `Other Lead HH ${TAG}` } })).id;
        otherLeadId = (await prisma.person.create({ data: { name: "Other Lead", householdId: otherLeadHh } })).id;

        const A = await makeHousehold("A", [{ name: "A-Gran", phone: "555-0101" }, { name: "A-Aunt", phone: "555-0102" }]);
        const B = await makeHousehold("B", [{ name: "B-Gran", phone: "555-0201" }]);
        const C = await makeHousehold("C", [{ name: "C-Gran", phone: "555-0301" }]);
        const D = await makeHousehold("D", [{ name: "D-Gran", phone: "555-0401" }]);
        const AUD = await makeHousehold("AUD", [
            { name: "Aud1", phone: "555-0501" }, { name: "Aud2", phone: "555-0502" }, { name: "Aud3", phone: "555-0503" },
        ]);
        hhA = A.hhId; hhB = B.hhId; hhD = D.hhId; hhAudit = AUD.hhId;

        const mk = async (name: string, leadMentorId: number, startAt: Date | null, endAt: Date | null, childId: number) => {
            const p = await prisma.program.create({ data: { name: `${name} ${TAG}`, leadMentorId, startAt, endAt } });
            await prisma.programParticipant.create({ data: { programId: p.id, personId: childId, status: "ACTIVE" } });
            return p.id;
        };
        inWindowProg = await mk("InWindow", leadId, new Date(now - 3 * DAY), new Date(now + 3 * DAY), A.childId);
        outWindowProg = await mk("OutWindow", leadId, new Date(now - 60 * DAY), new Date(now - 40 * DAY), B.childId);
        nullDatesProg = await mk("NullDates", leadId, null, null, C.childId);
        otherProg = await mk("OtherLead", otherLeadId, new Date(now - 3 * DAY), new Date(now + 3 * DAY), D.childId);
        auditProg = await mk("Audit", leadId, new Date(now - 3 * DAY), new Date(now + 3 * DAY), AUD.childId);
    });

    afterAll(async () => {
        await wipe();
        await prisma.$disconnect();
    });

    it("in-window: the lead sees the program's roster household contacts, and ONLY those", async () => {
        as(leadId, leadHh);
        const res = await ec(inWindowProg);
        expect(res.status).toBe(200);
        const body = await res.json();
        const hhIds = body.households.map((h: { householdId: number }) => h.householdId);
        expect(hhIds).toEqual([hhA]); // only the in-window program's household
        expect(hhIds).not.toContain(hhB); // out-of-window program's household
        expect(hhIds).not.toContain(hhD); // another lead's household
        const hh = body.households[0];
        expect(hh.contacts.map((c: { name: string }) => c.name).sort()).toEqual(["A-Aunt", "A-Gran"]);
        // Explicit shaping: no internal fields leak.
        expect(hh.contacts[0].phoneDigits).toBeUndefined();
        expect(hh.contacts[0].conflictParticipantId).toBeUndefined();
    });

    it("out-of-window: 403 with a time-scoping message", async () => {
        as(leadId, leadHh);
        const res = await ec(outWindowProg);
        expect(res.status).toBe(403);
        expect((await res.json()).error).toMatch(new RegExp(`${LEAD_EC_ACCESS_BUFFER_DAYS} days`));
    });

    it("null dates: fail closed with 403", async () => {
        as(leadId, leadHh);
        const res = await ec(nullDatesProg);
        expect(res.status).toBe(403);
        expect((await res.json()).error).toMatch(/no scheduled start and end dates/i);
    });

    it("off-roster: a lead cannot view a program they don't lead", async () => {
        as(leadId, leadHh);
        const res = await ec(otherProg);
        expect(res.status).toBe(403);
        expect((await res.json()).error).toMatch(/programs you lead/i);
    });

    it("non-lead board member is 403 on this route but unaffected on /safety", async () => {
        as(boardId, boardHh, { isBoardMember: true });
        expect((await ec(inWindowProg)).status).toBe(403);
        // Board's own route still serves emergency contacts.
        const safety = await SAFETY(get("/api/safety/emergency-contacts"));
        expect(safety.status).toBe(200);
        expect(Array.isArray((await safety.json()).households)).toBe(true);
    });

    it("audits one READ row per household per view — not per contact", async () => {
        const countRows = () =>
            prisma.auditLog.count({ where: { action: "READ", tableName: "EmergencyContact", affectedEntityId: hhAudit, actorId: leadId } });
        expect(await countRows()).toBe(0);

        as(leadId, leadHh);
        expect((await ec(auditProg)).status).toBe(200);
        expect(await countRows()).toBe(1); // one view → one row, though the household has 3 contacts

        const row = await prisma.auditLog.findFirst({
            where: { action: "READ", tableName: "EmergencyContact", affectedEntityId: hhAudit, actorId: leadId },
        });
        expect(row?.secondaryAffectedEntity).toBe(auditProg);

        expect((await ec(auditProg)).status).toBe(200);
        expect(await countRows()).toBe(2); // each view is audited
    });
});
