/**
 * @jest-environment node
 */
/**
 * Integration tests for the emergency-contact service against a real database.
 * Covers the not-a-household-member rule in both directions, the partial-save
 * tolerance, the >=1-valid floor, and the admin alarm count.
 */
import prisma from "@/lib/prisma";
import {
    createContact,
    updateContact,
    deleteContact,
    upsertPrimaryContact,
    reconcileHouseholdConflicts,
    reconcileAndWarn,
    householdHasValidContact,
    listValidContacts,
    countHouseholdsMissingValidContact,
    EmergencyContactError,
} from "@/lib/emergencyContacts/service";

const TAG = "ec-service-test";

async function wipe() {
    const tagged = await prisma.household.findMany({ where: { name: { contains: TAG } }, select: { id: true } });
    const hhIds = tagged.map((h) => h.id);
    if (hhIds.length === 0) return;
    await prisma.emergencyContact.deleteMany({ where: { householdId: { in: hhIds } } });
    await prisma.membershipProcess.deleteMany({ where: { membership: { householdId: { in: hhIds } } } });
    await prisma.membership.deleteMany({ where: { householdId: { in: hhIds } } });
    await prisma.householdLead.deleteMany({ where: { householdId: { in: hhIds } } });
    await prisma.participant.deleteMany({ where: { householdId: { in: hhIds } } });
    await prisma.household.deleteMany({ where: { id: { in: hhIds } } });
}

async function makeHousehold(suffix: string) {
    const hh = await prisma.household.create({ data: { name: `${TAG}-${suffix}` } });
    return hh.id;
}

async function addMember(householdId: number, data: { name?: string; email?: string; phone?: string }) {
    return prisma.participant.create({ data: { householdId, ...data } });
}

beforeAll(wipe);
afterAll(async () => {
    await wipe();
    await prisma.$disconnect();
});

describe("createContact — direction A (hard)", () => {
    it("allows an external contact", async () => {
        const hh = await makeHousehold("ext");
        await addMember(hh, { name: "Parent One", phone: "555-1000" });
        const c = await createContact(prisma, hh, { name: "Aunt May", phone: "555-2000" });
        expect(c.id).toBeGreaterThan(0);
        expect(c.phoneDigits).toBe("5552000");
        expect(c.conflictParticipantId).toBeNull();
    });

    it("rejects a contact matching a member by phone (any format)", async () => {
        const hh = await makeHousehold("phone");
        await addMember(hh, { name: "Parent One", phone: "(555) 100-0" });
        await expect(createContact(prisma, hh, { name: "Someone Else", phone: "5551000" })).rejects.toBeInstanceOf(EmergencyContactError);
    });

    it("rejects a contact matching a member by email", async () => {
        const hh = await makeHousehold("email");
        await addMember(hh, { name: "Parent One", email: "shared@x.com", phone: "555-1000" });
        await expect(
            createContact(prisma, hh, { name: "Someone Else", phone: "555-9999", email: "SHARED@x.com" }),
        ).rejects.toBeInstanceOf(EmergencyContactError);
    });

    it("rejects a contact matching a member by name", async () => {
        const hh = await makeHousehold("name");
        await addMember(hh, { name: "Jane Doe", phone: "555-1000" });
        await expect(createContact(prisma, hh, { name: "jane doe", phone: "555-9999" })).rejects.toBeInstanceOf(EmergencyContactError);
    });

    it("allows the same phone as a member of a DIFFERENT household", async () => {
        const a = await makeHousehold("cross-a");
        const b = await makeHousehold("cross-b");
        await addMember(a, { name: "Parent A", phone: "555-7777" });
        const c = await createContact(prisma, b, { name: "Neighbor", phone: "555-7777" });
        expect(c.id).toBeGreaterThan(0);
    });
});

describe("upsertPrimaryContact — partial tolerance + member rejection", () => {
    it("persists a partial contact without the member check", async () => {
        const hh = await makeHousehold("partial");
        await addMember(hh, { name: "Jane Doe", phone: "555-1000" });
        // name only, and it equals a member — tolerated because incomplete.
        const c = await upsertPrimaryContact(prisma, hh, { name: "Jane Doe", phone: "" });
        expect(c).not.toBeNull();
        expect(await householdHasValidContact(prisma, hh)).toBe(false);
    });

    it("rejects a complete contact that is a member", async () => {
        const hh = await makeHousehold("upsert-member");
        await addMember(hh, { name: "Jane Doe", phone: "555-1000" });
        await expect(upsertPrimaryContact(prisma, hh, { name: "Jane Doe", phone: "555-1000" })).rejects.toBeInstanceOf(EmergencyContactError);
    });

    it("updates the same primary row on repeat", async () => {
        const hh = await makeHousehold("upsert-update");
        await upsertPrimaryContact(prisma, hh, { name: "Aunt May", phone: "555-2000" });
        await upsertPrimaryContact(prisma, hh, { name: "Aunt May", phone: "555-3000" });
        const all = await prisma.emergencyContact.findMany({ where: { householdId: hh } });
        expect(all).toHaveLength(1);
        expect(all[0].phone).toBe("555-3000");
    });
});

describe("reconcileHouseholdConflicts — direction B (soft)", () => {
    it("flags a contact when a matching member is added later, then clears on remediation", async () => {
        const hh = await makeHousehold("recon");
        const contact = await createContact(prisma, hh, { name: "Aunt May", phone: "555-2000" });
        expect(await householdHasValidContact(prisma, hh)).toBe(true);

        // A new member turns out to be the emergency contact.
        await addMember(hh, { name: "Aunt May", phone: "555-2000" });
        const flagged = await reconcileHouseholdConflicts(prisma, hh);
        expect(flagged.map((c) => c.id)).toContain(contact.id);
        expect(await householdHasValidContact(prisma, hh)).toBe(false);

        const after = await prisma.emergencyContact.findUnique({ where: { id: contact.id } });
        expect(after?.conflictParticipantId).not.toBeNull();

        // Remediation: add a real external replacement -> household valid again.
        await createContact(prisma, hh, { name: "Neighbor Bob", phone: "555-4000" });
        expect(await householdHasValidContact(prisma, hh)).toBe(true);
        expect((await listValidContacts(prisma, hh)).map((c) => c.name)).toEqual(["Neighbor Bob"]);
    });

    it("reconcileAndWarn returns a warning with hasValidContact=false when the only contact is flagged", async () => {
        const hh = await makeHousehold("warn");
        await createContact(prisma, hh, { name: "Aunt May", phone: "555-2000" });
        await addMember(hh, { name: "Aunt May", phone: "555-2000" });
        const warning = await reconcileAndWarn(prisma, hh);
        expect(warning).not.toBeNull();
        expect(warning!.code).toBe("EMERGENCY_CONTACT_CONFLICT");
        expect(warning!.hasValidContact).toBe(false);
    });

    it("returns null when nothing changed", async () => {
        const hh = await makeHousehold("noop");
        await createContact(prisma, hh, { name: "Aunt May", phone: "555-2000" });
        await addMember(hh, { name: "Unrelated Kid", phone: "555-8888" });
        expect(await reconcileAndWarn(prisma, hh)).toBeNull();
    });
});

describe("updateContact + deleteContact", () => {
    it("clears a conflict flag when the contact is edited to an external person", async () => {
        const hh = await makeHousehold("update-clear");
        const contact = await createContact(prisma, hh, { name: "Aunt May", phone: "555-2000" });
        await addMember(hh, { name: "Aunt May", phone: "555-2000" });
        await reconcileHouseholdConflicts(prisma, hh);
        expect(await householdHasValidContact(prisma, hh)).toBe(false);

        await updateContact(prisma, hh, contact.id, { name: "Aunt Maybelle", phone: "555-2001" });
        expect(await householdHasValidContact(prisma, hh)).toBe(true);
    });

    it("deletes a contact", async () => {
        const hh = await makeHousehold("del");
        const c = await createContact(prisma, hh, { name: "Temp", phone: "555-2000" });
        await deleteContact(prisma, hh, c.id);
        expect(await prisma.emergencyContact.findUnique({ where: { id: c.id } })).toBeNull();
    });
});

describe("countHouseholdsMissingValidContact — admin alarm", () => {
    it("counts only member/in-intake households lacking a valid contact", async () => {
        const baseline = await countHouseholdsMissingValidContact(prisma);

        // In-intake household with a flagged (invalid) contact -> should count.
        const hh = await makeHousehold("alarm-intake");
        const m = await prisma.membership.create({ data: { householdId: hh, status: "NONE" } });
        await prisma.membershipProcess.create({ data: { membershipId: m.id, kind: "INITIAL", status: "INTAKE" } });
        await createContact(prisma, hh, { name: "Aunt May", phone: "555-2000" });
        await addMember(hh, { name: "Aunt May", phone: "555-2000" });
        await reconcileHouseholdConflicts(prisma, hh);

        // A non-member household with no contact -> should NOT count.
        await makeHousehold("alarm-nonmember");

        expect(await countHouseholdsMissingValidContact(prisma)).toBe(baseline + 1);

        // Remediate -> count returns to baseline.
        await createContact(prisma, hh, { name: "Neighbor Bob", phone: "555-4000" });
        expect(await countHouseholdsMissingValidContact(prisma)).toBe(baseline);
    });
});
