import {
    parseUSDate,
    parseZoho,
    buildImport,
    resolveEmailCollisions,
    applyImport,
    renderReport,
    type RawPerson,
    type RawFamily,
    type RawInput,
    type BuiltMember,
    type BuiltHousehold,
    type ImportReport,
} from "@/lib/dev/zoho-import";

const NOW = new Date(Date.UTC(2026, 5, 14, 12, 0, 0)); // 2026-06-14, matches the export era

function person(p: Partial<RawPerson>): RawPerson {
    return {
        Name: "",
        Email: "",
        Primary_Contact_E_mail: "",
        Date_Of_Birth: "",
        BG_Check_Status: "Optional",
        Background_Check_Approval_Date: "",
        Background_Check_Approvals: "",
        ID: "",
        ...p,
    };
}
function family(f: Partial<RawFamily>): RawFamily {
    return { Primary_Contact_E_mail: "", Address: "", Primary_Contact_Name: "", Primary_Contact_DoB: "", ID: "", ...f };
}
function input(i: Partial<RawInput>): RawInput {
    return {
        Primary_Contact_E_mail: "",
        Payment_Status: "",
        Membership_Agreement_Status: "",
        Address: "",
        Primary_Contact_Name: "",
        Primary_Contact_DoB: "",
        ID: "",
        "Participant_Information.Name": "",
        ...i,
    };
}

describe("parseUSDate", () => {
    it("parses MM/DD/YYYY at UTC noon", () => {
        const d = parseUSDate("03/04/2012")!;
        expect(d.toISOString().slice(0, 10)).toBe("2012-03-04");
    });
    it("returns null on blank or malformed input", () => {
        expect(parseUSDate("")).toBeNull();
        expect(parseUSDate("2012-03-04")).toBeNull();
        expect(parseUSDate("13/40/2012")).toBeNull();
        expect(parseUSDate("02/31/2012")).toBeNull(); // overflow rejected
    });
});

describe("buildImport", () => {
    function build(people: RawPerson[], families: RawFamily[], inputs: RawInput[]) {
        return buildImport(parseZoho({
            list: { Full_Member_List: people },
            families: { All_Member_Families: families },
            inputs: { All_Member_Inputs: inputs },
        }), NOW);
    }

    it("groups people into households by primary-contact email and names the household", () => {
        const { households, report } = build(
            [
                person({ Name: "Nevin Spinosa", Email: "nnspinosa@gmail.com", Primary_Contact_E_mail: "nnspinosa@gmail.com", Date_Of_Birth: "05/24/1983", ID: "p1" }),
                person({ Name: "Altan Spinosa", Email: "nnspinosa@gmail.com", Primary_Contact_E_mail: "nnspinosa@gmail.com", Date_Of_Birth: "07/25/2015", ID: "p2" }),
            ],
            [family({ Primary_Contact_E_mail: "nnspinosa@gmail.com", Primary_Contact_Name: "Nevin Spinosa", Address: "388 Sawtooth, TX", ID: "f1" })],
            [input({ Primary_Contact_E_mail: "nnspinosa@gmail.com" })],
        );
        expect(households).toHaveLength(1);
        const h = households[0];
        expect(h.name).toBe("Spinosa Household");
        expect(h.address).toBe("388 Sawtooth, TX");
        expect(h.members).toHaveLength(2);
        expect(report.participants).toBe(2);
    });

    it("keeps the shared email on the primary contact and nulls it for others", () => {
        const { households, report } = build(
            [
                person({ Name: "Nevin Spinosa", Email: "nnspinosa@gmail.com", Primary_Contact_E_mail: "nnspinosa@gmail.com", Date_Of_Birth: "05/24/1983", ID: "p1" }),
                person({ Name: "Altan Spinosa", Email: "nnspinosa@gmail.com", Primary_Contact_E_mail: "nnspinosa@gmail.com", Date_Of_Birth: "07/25/2015", ID: "p2" }),
            ],
            [family({ Primary_Contact_E_mail: "nnspinosa@gmail.com", Primary_Contact_Name: "Nevin Spinosa" })],
            [input({ Primary_Contact_E_mail: "nnspinosa@gmail.com" })],
        );
        const members = households[0].members;
        const nevin = members.find((m) => m.name === "Nevin Spinosa")!;
        const altan = members.find((m) => m.name === "Altan Spinosa")!;
        expect(nevin.email).toBe("nnspinosa@gmail.com");
        expect(nevin.isPrimary).toBe(true);
        expect(altan.email).toBeNull();
        expect(report.emailCollisions).toHaveLength(1);
        expect(report.emailCollisions[0].nulledFor[0]).toContain("Altan Spinosa");
    });

    it("flags an email reused across two households (possible duplicate person)", () => {
        const { report } = build(
            [
                person({ Name: "Marguerite Erickson", Email: "jms367@cornell.edu", Primary_Contact_E_mail: "jms367@cornell.edu", ID: "p1" }),
                person({ Name: "Jean Erickson", Email: "jms367@cornell.edu", Primary_Contact_E_mail: "jee7s@uva.edu", ID: "p2" }),
                person({ Name: "Jeffrey Erickson", Email: "jee7s@uva.edu", Primary_Contact_E_mail: "jee7s@uva.edu", ID: "p3" }),
            ],
            [family({ Primary_Contact_E_mail: "jms367@cornell.edu", Primary_Contact_Name: "Marguerite Erickson" }), family({ Primary_Contact_E_mail: "jee7s@uva.edu", Primary_Contact_Name: "Jeffrey Erickson" })],
            [input({ Primary_Contact_E_mail: "jms367@cornell.edu" }), input({ Primary_Contact_E_mail: "jee7s@uva.edu" })],
        );
        expect(report.flags.some((f) => f.includes("jms367@cornell.edu") && f.includes("possible duplicate"))).toBe(true);
    });

    it("activates membership only when payment AND agreement are both Completed", () => {
        const mk = (pay: string, agree: string) =>
            build(
                [person({ Name: "A B", Email: "a@b.com", Primary_Contact_E_mail: "a@b.com", Date_Of_Birth: "01/01/1980", ID: "p1" })],
                [family({ Primary_Contact_E_mail: "a@b.com", Primary_Contact_Name: "A B" })],
                [input({ Primary_Contact_E_mail: "a@b.com", Payment_Status: pay, Membership_Agreement_Status: agree })],
            ).households[0].membershipActive;
        expect(mk("Completed", "Completed")).toBe(true);
        expect(mk("Completed", "Pending")).toBe(false);
        expect(mk("", "")).toBe(false);
    });

    it("skips blank-name people and records them", () => {
        const { households, report } = build(
            [
                person({ Name: "Real Person", Email: "a@b.com", Primary_Contact_E_mail: "a@b.com", ID: "p1" }),
                person({ Name: "  ", Email: "", Primary_Contact_E_mail: "a@b.com", ID: "p2" }),
            ],
            [family({ Primary_Contact_E_mail: "a@b.com", Primary_Contact_Name: "Real Person" })],
            [input({ Primary_Contact_E_mail: "a@b.com" })],
        );
        expect(households[0].members).toHaveLength(1);
        expect(report.blankNamesSkipped).toHaveLength(1);
        expect(report.blankNamesSkipped[0].zohoId).toBe("p2");
    });

    it("merges the Danae Kay join-key mismatch into one household via the alias", () => {
        const { households } = build(
            [
                person({ Name: "Danae Kay", Email: "danaekay@innovationtreehouse.org", Primary_Contact_E_mail: "danaekay@innovationtreehouse.org", Date_Of_Birth: "05/08/1995", ID: "p1" }),
                person({ Name: "Eli Kay", Email: "", Primary_Contact_E_mail: "danaekay@innovationtreehouse.org", Date_Of_Birth: "08/10/2021", ID: "p2" }),
            ],
            [family({ Primary_Contact_E_mail: "danaekay17@gmail.com", Primary_Contact_Name: "Danae Kay", Address: "126 Grapevine Ct" })],
            [input({ Primary_Contact_E_mail: "danaekay17@gmail.com" })],
        );
        expect(households).toHaveLength(1);
        expect(households[0].name).toBe("Kay Household");
        expect(households[0].address).toBe("126 Grapevine Ct");
        // Primary detected by name (email doesn't match the family key).
        const danae = households[0].members.find((m) => m.name === "Danae Kay")!;
        expect(danae.isPrimary).toBe(true);
        expect(danae.email).toBe("danaekay@innovationtreehouse.org");
    });

    it("sets lastBackgroundCheck only for Approved people", () => {
        const { households } = build(
            [
                person({ Name: "Approved One", Email: "a@b.com", Primary_Contact_E_mail: "a@b.com", BG_Check_Status: "Approved", Background_Check_Approval_Date: "08/26/2024", Background_Check_Approvals: "Jeff Erickson,Danae Kay", ID: "p1" }),
                person({ Name: "Pending Two", Email: "", Primary_Contact_E_mail: "a@b.com", BG_Check_Status: "Results Ready", Background_Check_Approval_Date: "", ID: "p2" }),
            ],
            [family({ Primary_Contact_E_mail: "a@b.com", Primary_Contact_Name: "Approved One" })],
            [input({ Primary_Contact_E_mail: "a@b.com" })],
        );
        const members = households[0].members;
        expect(members.find((m) => m.name === "Approved One")!.lastBackgroundCheck?.toISOString().slice(0, 10)).toBe("2024-08-26");
        expect(members.find((m) => m.name === "Pending Two")!.lastBackgroundCheck).toBeNull();
    });

    it("flags a youth listed as primary contact", () => {
        const { report } = build(
            [person({ Name: "Ari Mizell", Email: "kailemizell@gmail.com", Primary_Contact_E_mail: "kailemizell@gmail.com", Date_Of_Birth: "03/04/2012", ID: "p1" })],
            [family({ Primary_Contact_E_mail: "kailemizell@gmail.com", Primary_Contact_Name: "Ari Mizell" })],
            [input({ Primary_Contact_E_mail: "kailemizell@gmail.com" })],
        );
        expect(report.youthAsPrimary).toHaveLength(1);
        expect(report.youthAsPrimary[0].name).toBe("Ari Mizell");
    });

    it("declares the primary an adult only when Zoho has no DoB (age model, #606)", () => {
        // Primary WITH a DoB → age derived, not declared. Child (non-primary, no DoB) → unknown, not declared.
        const withDob = build(
            [
                person({ Name: "Pat Lee", Email: "pat@lee.com", Primary_Contact_E_mail: "pat@lee.com", Date_Of_Birth: "05/24/1983", ID: "p1" }),
                person({ Name: "Kid Lee", Email: "", Primary_Contact_E_mail: "pat@lee.com", ID: "p2" }),
            ],
            [family({ Primary_Contact_E_mail: "pat@lee.com", Primary_Contact_Name: "Pat Lee" })],
            [input({ Primary_Contact_E_mail: "pat@lee.com" })],
        );
        const pat = withDob.households[0].members.find((m) => m.name === "Pat Lee")!;
        const kid = withDob.households[0].members.find((m) => m.name === "Kid Lee")!;
        expect(pat.isDeclaredAdult).toBe(false); // has a DoB
        expect(kid.isDeclaredAdult).toBe(false); // non-primary, unknown age

        // Primary with NO DoB → declared adult, and surfaced in the report.
        const noDob = build(
            [person({ Name: "Sam Roe", Email: "sam@roe.com", Primary_Contact_E_mail: "sam@roe.com", ID: "p1" })],
            [family({ Primary_Contact_E_mail: "sam@roe.com", Primary_Contact_Name: "Sam Roe" })],
            [input({ Primary_Contact_E_mail: "sam@roe.com" })],
        );
        expect(noDob.households[0].members[0].isDeclaredAdult).toBe(true);
        expect(noDob.report.flags.some((f) => f.includes("declared adults"))).toBe(true);
    });

    it("falls back to the oldest member by DOB as primary when no name or email match the household key", () => {
        const { households } = build(
            [
                person({ Name: "Child Y", Email: "childy@nowhere.com", Primary_Contact_E_mail: "house@x.com", Date_Of_Birth: "07/25/2015", ID: "p1" }),
                person({ Name: "Adult X", Email: "adultx@nowhere.com", Primary_Contact_E_mail: "house@x.com", Date_Of_Birth: "05/24/1980", ID: "p2" }),
            ],
            [], // no family row -> no Primary_Contact_Name to match
            [],
        );
        const members = households[0].members;
        expect(members.find((m) => m.name === "Adult X")!.isPrimary).toBe(true);
        expect(members.find((m) => m.name === "Child Y")!.isPrimary).toBe(false);
    });

    it("falls back to the first row as primary when nobody has a name, email, or DOB match", () => {
        const { households } = build(
            [
                person({ Name: "First Row", Email: "first@nowhere.com", Primary_Contact_E_mail: "house2@x.com", ID: "p1" }),
                person({ Name: "Second Row", Email: "second@nowhere.com", Primary_Contact_E_mail: "house2@x.com", ID: "p2" }),
            ],
            [],
            [],
        );
        const members = households[0].members;
        expect(members.find((m) => m.name === "First Row")!.isPrimary).toBe(true);
        expect(members.find((m) => m.name === "Second Row")!.isPrimary).toBe(false);
    });
});

describe("resolveEmailCollisions fallback keeper selection", () => {
    function builtMember(p: Partial<BuiltMember> = {}): BuiltMember {
        return {
            name: "Member",
            email: null,
            dob: null,
            lastBackgroundCheck: null,
            isPrimary: false,
            isDeclaredAdult: false,
            source: { zohoId: "", rawEmail: "", bgStatus: "", bgApprovalDate: "", bgApprovers: "" },
            ...p,
        };
    }
    function builtHousehold(p: Partial<BuiltHousehold> = {}): BuiltHousehold {
        return {
            groupKey: "key@x.com",
            name: "Household",
            address: null,
            members: [],
            membershipActive: false,
            source: { familyZohoId: null, inputZohoId: null, rawPrimaryEmail: "" },
            ...p,
        };
    }
    function emptyReport(): ImportReport {
        return {
            households: 0,
            participants: 0,
            activeMemberships: 0,
            blankNamesSkipped: [],
            emailCollisions: [],
            youthAsPrimary: [],
            secondaryAdultsNotPromoted: 0,
            flags: [],
        };
    }

    it("prefers a primary contact even when their household key doesn't match the colliding email", () => {
        // Household A's primary uses the colliding email but their household key is different
        // (their own Email differs from the family's Primary_Contact_E_mail). Household B's
        // holder of the same email is a non-primary member. No ref satisfies (primary && groupKey===email).
        const householdA = builtHousehold({
            groupKey: "keyA@x.com",
            members: [builtMember({ name: "Prim A", email: "shared@x.com", isPrimary: true }), builtMember({ name: "Sec A2", email: null })],
        });
        const householdB = builtHousehold({
            groupKey: "keyB@x.com",
            members: [builtMember({ name: "Prim B", email: "keyB@x.com", isPrimary: true }), builtMember({ name: "Sec B2", email: "shared@x.com" })],
        });
        const report = emptyReport();
        resolveEmailCollisions([householdA, householdB], report);
        expect(report.emailCollisions).toHaveLength(1);
        expect(report.emailCollisions[0].keptFor).toContain("Prim A");
        expect(householdA.members.find((m) => m.name === "Prim A")!.email).toBe("shared@x.com");
        expect(householdB.members.find((m) => m.name === "Sec B2")!.email).toBeNull();
    });

    it("falls back to the first ref when no colliding member is a primary contact", () => {
        const householdC = builtHousehold({
            groupKey: "keyC@x.com",
            members: [builtMember({ name: "Prim C", email: "keyC@x.com", isPrimary: true }), builtMember({ name: "Sec C2", email: "shared2@x.com" })],
        });
        const householdD = builtHousehold({
            groupKey: "keyD@x.com",
            members: [builtMember({ name: "Prim D", email: "keyD@x.com", isPrimary: true }), builtMember({ name: "Sec D2", email: "shared2@x.com" })],
        });
        const report = emptyReport();
        resolveEmailCollisions([householdC, householdD], report);
        expect(report.emailCollisions).toHaveLength(1);
        expect(report.emailCollisions[0].keptFor).toContain("Sec C2");
        expect(householdC.members.find((m) => m.name === "Sec C2")!.email).toBe("shared2@x.com");
        expect(householdD.members.find((m) => m.name === "Sec D2")!.email).toBeNull();
    });
});

describe("applyImport", () => {
    function makeFakeTx() {
        let nextHouseholdId = 1;
        let nextParticipantId = 1;
        let nextMembershipId = 1;
        const households = new Map<number, { id: number; name: string; line1: string | null }>();
        const participants = new Map<
            number,
            { id: number; name: string; email: string | null; householdId: number; dateOfBirth: Date | null; lastBackgroundCheck: Date | null; isDeclaredAdult: boolean }
        >();
        const membershipsByHousehold = new Map<number, { id: number; householdId: number; status: string }>();
        const auditLogs: { action: string; tableName: string; affectedEntityId: number; newData: Record<string, unknown> }[] = [];

        const tx = {
            auditLog: {
                create: jest.fn(async ({ data }: { data: typeof auditLogs[number] }) => {
                    auditLogs.push(data);
                    return { id: auditLogs.length, ...data };
                }),
            },
            household: {
                create: jest.fn(async ({ data }: { data: { name: string; line1: string | null } }) => {
                    const id = nextHouseholdId++;
                    const h = { id, ...data };
                    households.set(id, h);
                    return h;
                }),
                update: jest.fn(async ({ where, data }: { where: { id: number }; data: { name: string; line1: string | null } }) => {
                    const h = { ...households.get(where.id)!, ...data };
                    households.set(where.id, h);
                    return h;
                }),
            },
            person: {
                findUnique: jest.fn(async ({ where }: { where: { email: string } }) => [...participants.values()].find((p) => p.email === where.email) ?? null),
                findFirst: jest.fn(
                    async ({ where }: { where: { householdId: number; name: string } }) =>
                        [...participants.values()].find((p) => p.householdId === where.householdId && p.name === where.name) ?? null,
                ),
                create: jest.fn(async ({ data }: { data: Omit<ReturnType<typeof participants.get> & object, "id"> }) => {
                    const id = nextParticipantId++;
                    const p = { id, ...(data as object) } as { id: number; name: string; email: string | null; householdId: number; dateOfBirth: Date | null; lastBackgroundCheck: Date | null; isDeclaredAdult: boolean };
                    participants.set(id, p);
                    return p;
                }),
                update: jest.fn(async ({ where, data }: { where: { id: number }; data: object }) => {
                    const p = { ...participants.get(where.id)!, ...data };
                    participants.set(where.id, p);
                    return p;
                }),
            },
            householdLead: { upsert: jest.fn(async () => ({})) },
            orgMembership: {
                findUnique: jest.fn(async ({ where }: { where: { householdId: number } }) => membershipsByHousehold.get(where.householdId) ?? null),
                upsert: jest.fn(async ({ where, create }: { where: { householdId: number }; create: { status: string } }) => {
                    const existing = membershipsByHousehold.get(where.householdId);
                    if (existing) {
                        existing.status = "ACTIVE";
                        return existing;
                    }
                    const m = { id: nextMembershipId++, householdId: where.householdId, status: create.status };
                    membershipsByHousehold.set(where.householdId, m);
                    return m;
                }),
            },
        };

        return { tx: tx as unknown as Parameters<typeof applyImport>[0], households, participants, membershipsByHousehold, auditLogs };
    }

    function buildOne() {
        return buildImport(
            parseZoho({
                list: {
                    Full_Member_List: [
                        person({
                            Name: "Sam Lee",
                            Email: "sam@lee.com",
                            Primary_Contact_E_mail: "sam@lee.com",
                            Date_Of_Birth: "01/01/1980",
                            BG_Check_Status: "Approved",
                            Background_Check_Approval_Date: "08/26/2024",
                            ID: "p1",
                        }),
                        person({ Name: "Kid Lee", Email: "", Primary_Contact_E_mail: "sam@lee.com", Date_Of_Birth: "01/01/2015", ID: "p2" }),
                    ],
                },
                families: { All_Member_Families: [family({ Primary_Contact_E_mail: "sam@lee.com", Primary_Contact_Name: "Sam Lee" })] },
                inputs: {
                    All_Member_Inputs: [input({ Primary_Contact_E_mail: "sam@lee.com", Payment_Status: "Completed", Membership_Agreement_Status: "Completed" })],
                },
            }),
            NOW,
        );
    }

    it("creates a new household, participants, and an active membership when nothing exists yet", async () => {
        const { tx, auditLogs } = makeFakeTx();
        const built = buildOne();
        const res = await applyImport(tx, built, 1);
        expect(res.householdsCreated).toBe(1);
        expect(res.householdsUpdated).toBe(0);
        expect(res.participantsCreated).toBe(2);
        expect(res.membershipsActivated).toBe(1);
        // The approved member gets a backgroundCheck note; the child (no approval) doesn't.
        const samAudit = auditLogs.find((a) => a.tableName === "Participant" && (a.newData as { name?: string }).name === "Sam Lee");
        const kidAudit = auditLogs.find((a) => a.tableName === "Participant" && (a.newData as { name?: string }).name === "Kid Lee");
        expect(samAudit!.newData).toHaveProperty("backgroundCheck");
        expect(kidAudit!.newData).not.toHaveProperty("backgroundCheck");
    });

    it("updates an existing household/participants by email and name, and doesn't double-count an already-ACTIVE membership", async () => {
        const { tx, households, participants, membershipsByHousehold } = makeFakeTx();
        households.set(1, { id: 1, name: "Old Name", line1: null });
        participants.set(1, { id: 1, name: "Sam Lee", email: "sam@lee.com", householdId: 1, dateOfBirth: null, lastBackgroundCheck: null, isDeclaredAdult: false });
        participants.set(2, { id: 2, name: "Kid Lee", email: null, householdId: 1, dateOfBirth: null, lastBackgroundCheck: null, isDeclaredAdult: false });
        membershipsByHousehold.set(1, { id: 1, householdId: 1, status: "ACTIVE" });

        const res = await applyImport(tx, buildOne(), 1);
        expect(res.householdsCreated).toBe(0);
        expect(res.householdsUpdated).toBe(1);
        expect(res.participantsCreated).toBe(0);
        expect(res.participantsUpdated).toBe(2); // Sam matched by email, Kid matched by householdId+name
        expect(res.membershipsActivated).toBe(0); // was already ACTIVE
    });
});

describe("renderReport", () => {
    it("renders every section, including both branches of the blank-name-row and primary-name fallbacks", () => {
        const report: ImportReport = {
            households: 2,
            participants: 5,
            activeMemberships: 1,
            blankNamesSkipped: [
                { zohoId: "z1", householdKey: "keyA", householdPrimaryName: "Primary A", rowEmail: "a@b.com", rowDob: "01/01/2000" },
                { zohoId: "z2", householdKey: "keyB", householdPrimaryName: "", rowEmail: "", rowDob: "" },
            ],
            emailCollisions: [{ email: "dup@x.com", keptFor: "Keeper (keyA)", nulledFor: ["Loser (keyB)"] }],
            youthAsPrimary: [{ name: "Kid", dob: "2015-01-01", householdKey: "keyA" }],
            secondaryAdultsNotPromoted: 3,
            flags: ["Some flag message"],
        };
        const text = renderReport(report);
        expect(text).toContain("Households:          2");
        expect(text).toContain("Participants:        5");
        expect(text).toContain("Active memberships:  1");
        expect(text).toContain('person ID z1 in household "keyA" (primary: Primary A) — email a@b.com, dob 01/01/2000');
        expect(text).toContain('person ID z2 in household "keyB" (no family primary on file) — no name/email/dob on the row');
        expect(text).toContain("dup@x.com: kept for Keeper (keyA); nulled for Loser (keyB)");
        expect(text).toContain("Kid (DOB 2015-01-01, household keyA)");
        expect(text).toContain("Secondary adults not promoted to lead: 3");
        expect(text).toContain("! Some flag message");
    });
});
