import { parseUSDate, parseZoho, buildImport, type RawPerson, type RawFamily, type RawInput } from "@/lib/dev/zoho-import";

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

    it("flags a minor listed as primary contact", () => {
        const { report } = build(
            [person({ Name: "Ari Mizell", Email: "kailemizell@gmail.com", Primary_Contact_E_mail: "kailemizell@gmail.com", Date_Of_Birth: "03/04/2012", ID: "p1" })],
            [family({ Primary_Contact_E_mail: "kailemizell@gmail.com", Primary_Contact_Name: "Ari Mizell" })],
            [input({ Primary_Contact_E_mail: "kailemizell@gmail.com" })],
        );
        expect(report.minorsAsPrimary).toHaveLength(1);
        expect(report.minorsAsPrimary[0].name).toBe("Ari Mizell");
    });
});
