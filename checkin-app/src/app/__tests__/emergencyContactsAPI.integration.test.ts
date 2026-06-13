/**
 * @jest-environment node
 */
/**
 * Integration tests for the household emergency-contact API, focused on the
 * "can't remove the last valid contact" prohibition and the lead gate.
 */
import { POST, GET } from "@/app/api/household/emergency-contacts/route";
import { DELETE } from "@/app/api/household/emergency-contacts/[contactId]/route";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";

jest.mock("next-auth/next", () => ({ getServerSession: jest.fn() }));

const TAG = "ec-api-test";

function asUser(id: number) {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { id, sysadmin: false } });
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

async function wipe() {
    const hhs = await prisma.household.findMany({ where: { name: { contains: TAG } }, select: { id: true } });
    const ids = hhs.map((h) => h.id);
    if (!ids.length) return;
    await prisma.emergencyContact.deleteMany({ where: { householdId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { tableName: "EmergencyContact", secondaryAffectedEntity: { in: ids } } });
    await prisma.householdLead.deleteMany({ where: { householdId: { in: ids } } });
    await prisma.participant.deleteMany({ where: { householdId: { in: ids } } });
    await prisma.household.deleteMany({ where: { id: { in: ids } } });
}

describe("Emergency Contacts API — removal prohibition", () => {
    let leadId: number;
    let householdId: number;

    beforeAll(async () => {
        await wipe();
        const lead = await prisma.participant.create({
            data: { email: `lead-${TAG}@example.com`, name: "Lead Person", household: { create: { name: `HH ${TAG}` } } },
        });
        leadId = lead.id;
        householdId = lead.householdId!;
        await prisma.householdLead.create({ data: { householdId, participantId: leadId } });
    });

    afterAll(async () => {
        await wipe();
        await prisma.$disconnect();
    });

    it("blocks removing the only valid contact", async () => {
        asUser(leadId);
        const created = await (await POST(postReq({ name: "Aunt May", phone: "555-2000" }))).json();
        const res = await DELETE(delReq(), delCtx(created.contact.id));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/at least one valid emergency contact|second emergency contact/i);
        // contact still present
        const list = await (await GET(getReq())).json();
        expect(list.contacts.some((c: { id: number }) => c.id === created.contact.id)).toBe(true);
    });

    it("allows removal once a second valid contact exists", async () => {
        asUser(leadId);
        const a = await (await POST(postReq({ name: "Aunt May", phone: "555-2000" }))).json();
        await (await POST(postReq({ name: "Neighbor Bob", phone: "555-4000" }))).json();
        const res = await DELETE(delReq(), delCtx(a.contact.id));
        expect(res.status).toBe(200);
        const list = await (await GET(getReq())).json();
        expect(list.contacts.some((c: { id: number }) => c.id === a.contact.id)).toBe(false);
    });

    it("allows removing an already-invalid contact even if no valid one remains", async () => {
        asUser(leadId);
        // Fresh household to isolate state.
        const hh = await prisma.household.create({ data: { name: `HH2 ${TAG}` } });
        const p = await prisma.participant.create({ data: { email: `lead2-${TAG}@example.com`, name: "Lead Two", householdId: hh.id } });
        await prisma.householdLead.create({ data: { householdId: hh.id, participantId: p.id } });
        // A contact that is flagged invalid (simulate a direction-B conflict).
        const member = await prisma.participant.create({ data: { name: "Clashy", householdId: hh.id } });
        const invalid = await prisma.emergencyContact.create({
            data: { householdId: hh.id, name: "Clashy", phone: "555-9000", phoneDigits: "5559000", conflictParticipantId: member.id, conflictedAt: new Date() },
        });
        asUser(p.id);
        const res = await DELETE(delReq(), delCtx(invalid.id));
        expect(res.status).toBe(200);
    });
});
