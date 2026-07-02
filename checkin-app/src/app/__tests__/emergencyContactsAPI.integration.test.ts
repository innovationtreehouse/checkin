/**
 * @jest-environment node
 */
/**
 * Integration tests for the household emergency-contact API, focused on the
 * "can't remove the last valid contact" prohibition and the lead gate.
 */
import { POST, GET } from "@/app/api/household/emergency-contacts/route";
import { DELETE, PATCH } from "@/app/api/household/emergency-contacts/[contactId]/route";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { expectAuditRow, auditJson } from '@/test-helpers/expectAuditRow';

jest.mock("next-auth/next", () => ({ getServerSession: jest.fn() }));

const TAG = "ec-api-test";

function asUser(id: number) {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { id, isSysadmin: false } });
}
function postReq(body: unknown) {
    return new Request("http://localhost:4000/api/household/emergency-contacts", {
        method: "POST",
        body: JSON.stringify(body),
    }) as never;
}
const getReq = () => new Request("http://localhost:4000/api/household/emergency-contacts") as never;
function delCtx(contactId: number) {
    return { params: Promise.resolve({ contactId: String(contactId) }) } as never;
}
const delReq = () => new Request("http://localhost:4000/x", { method: "DELETE" }) as never;
function patchReq(body: unknown) {
    return new Request("http://localhost:4000/x", { method: "PATCH", body: JSON.stringify(body) }) as never;
}

async function wipe() {
    const hhs = await prisma.household.findMany({ where: { name: { contains: TAG } }, select: { id: true } });
    const ids = hhs.map((h) => h.id);
    if (!ids.length) return;
    await prisma.emergencyContact.deleteMany({ where: { householdId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { tableName: "EmergencyContact", secondaryAffectedEntity: { in: ids } } });
    await prisma.householdLead.deleteMany({ where: { householdId: { in: ids } } });
    await prisma.person.deleteMany({ where: { householdId: { in: ids } } });
    await prisma.household.deleteMany({ where: { id: { in: ids } } });
}

describe("Emergency Contacts API — removal prohibition", () => {
    let leadId: number;
    let householdId: number;

    beforeAll(async () => {
        await wipe();
        const lead = await prisma.person.create({
            data: { email: `lead-${TAG}@example.com`, name: "Lead Person", household: { create: { name: `HH ${TAG}` } } },
        });
        leadId = lead.id;
        householdId = lead.householdId!;
        await prisma.householdLead.create({ data: { householdId, personId: leadId } });
    });

    afterAll(async () => {
        await wipe();
        await prisma.$disconnect();
    });

    it("rejects a contact with a malformed email — 400", async () => {
        asUser(leadId);
        const res = await POST(postReq({ name: "Bad Email", phone: "555-555-9000", email: "not-an-email" }));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe("Invalid email format");
    });

    it("blocks removing the only valid contact", async () => {
        asUser(leadId);
        const created = await (await POST(postReq({ name: "Aunt May", phone: "555-555-2000" }))).json();
        const res = await DELETE(delReq(), delCtx(created.contact.id));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/at least one valid emergency contact|second emergency contact/i);
        // contact still present
        const list = await (await GET(getReq())).json();
        expect(list.contacts.some((c: { id: number }) => c.id === created.contact.id)).toBe(true);
    });

    it("allows removal once a second valid contact exists", async () => {
        asUser(leadId);
        const a = await (await POST(postReq({ name: "Aunt May", phone: "555-555-2000" }))).json();
        await (await POST(postReq({ name: "Neighbor Bob", phone: "555-555-4000" }))).json();
        const res = await DELETE(delReq(), delCtx(a.contact.id));
        expect(res.status).toBe(200);
        const list = await (await GET(getReq())).json();
        expect(list.contacts.some((c: { id: number }) => c.id === a.contact.id)).toBe(false);
    });

    it("allows removing an already-invalid contact even if no valid one remains", async () => {
        asUser(leadId);
        // Fresh household to isolate state.
        const hh = await prisma.household.create({ data: { name: `HH2 ${TAG}` } });
        const p = await prisma.person.create({ data: { email: `lead2-${TAG}@example.com`, name: "Lead Two", householdId: hh.id } });
        await prisma.householdLead.create({ data: { householdId: hh.id, personId: p.id } });
        // A contact that is flagged invalid (simulate a direction-B conflict).
        const member = await prisma.person.create({ data: { name: "Clashy", householdId: hh.id } });
        const invalid = await prisma.emergencyContact.create({
            data: { householdId: hh.id, name: "Clashy", phone: "555-9000", phoneDigits: "5559000", conflictParticipantId: member.id, conflictedAt: new Date() },
        });
        asUser(p.id);
        const res = await DELETE(delReq(), delCtx(invalid.id));
        expect(res.status).toBe(200);
    });

    async function makeHouseholdWithLead(label: string) {
        const hh = await prisma.household.create({ data: { name: `HH ${label} ${TAG}` } });
        const lead = await prisma.person.create({
            data: { email: `lead-${label}-${TAG}@example.com`, name: `Lead ${label}`, householdId: hh.id },
        });
        await prisma.householdLead.create({ data: { householdId: hh.id, personId: lead.id } });
        return { hhId: hh.id, leadId: lead.id };
    }

    it("a lead cannot DELETE or PATCH a contact in another household — 404, contact untouched", async () => {
        const A = await makeHouseholdWithLead("boundaryA");
        const B = await makeHouseholdWithLead("boundaryB");

        asUser(B.leadId);
        const cB = await (await POST(postReq({ name: "B Contact", phone: "555-555-7000" }))).json();

        // Lead of A scopes to A's household; B's contact is invisible -> 404.
        asUser(A.leadId);
        expect((await DELETE(delReq(), delCtx(cB.contact.id))).status).toBe(404);
        expect((await PATCH(patchReq({ name: "Hacked", phone: "555-555-0000" }), delCtx(cB.contact.id))).status).toBe(404);

        const still = await prisma.emergencyContact.findUnique({ where: { id: cB.contact.id } });
        expect(still).not.toBeNull();
        expect(still?.name).toBe("B Contact"); // PATCH must not have leaked across the boundary
    });

    it("the owning lead's DELETE and PATCH each write an audit row with actor + household", async () => {
        const A = await makeHouseholdWithLead("audit");
        asUser(A.leadId);
        const c1 = await (await POST(postReq({ name: "May", phone: "555-555-1000" }))).json();
        const c2 = await (await POST(postReq({ name: "Bob", phone: "555-555-2000" }))).json();

        const pr = await PATCH(patchReq({ name: "May Updated", phone: "555-555-1111" }), delCtx(c1.contact.id));
        expect(pr.status).toBe(200);
        const patchLog = await expectAuditRow(prisma, { action: "EDIT", tableName: "EmergencyContact", affectedEntityId: c1.contact.id });
        expect(patchLog.actorId).toBe(A.leadId);
        expect(patchLog.secondaryAffectedEntity).toBe(A.hhId);
        expect(auditJson(patchLog.newData).name).toBe("May Updated");

        // c1 is still a valid contact, so removing c2 is allowed.
        const dr = await DELETE(delReq(), delCtx(c2.contact.id));
        expect(dr.status).toBe(200);
        const delLog = await expectAuditRow(prisma, { action: "DELETE", tableName: "EmergencyContact", affectedEntityId: c2.contact.id });
        expect(delLog.actorId).toBe(A.leadId);
        expect(delLog.secondaryAffectedEntity).toBe(A.hhId);
    });
});
