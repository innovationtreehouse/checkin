import { INTAKE_PROFILES, missingRequiredFields } from "@/lib/intake/profiles";

describe("intake profiles registry", () => {
    it("membership-initial requires address + emergencyContact + primaryName", () => {
        const req = INTAKE_PROFILES["membership-initial"].requiredAtSubmit;
        expect(req).toEqual(["address", "emergencyContact", "primaryName"]);
    });

    it("program-first-time requires primaryName + emergencyContact + participantDob but NOT address", () => {
        const req = INTAKE_PROFILES["program-first-time"].requiredAtSubmit;
        expect(req).toEqual(expect.arrayContaining(["primaryName", "emergencyContact", "participantDob"]));
        expect(req).not.toContain("address");
        // Address is still shown (collected if offered), just not required.
        expect(INTAKE_PROFILES["program-first-time"].shown).toContain("address");
    });

    it("missingRequiredFields flags empty membership-initial fields in profile order", () => {
        const missing = missingRequiredFields(INTAKE_PROFILES["membership-initial"], {
            addressLine1: null,
            emergencyContacts: [],
            primaryName: null,
        });
        expect(missing.map((m) => m.field)).toEqual(["address", "emergencyContact", "primaryName"]);
    });

    it("missingRequiredFields returns [] when membership-initial is satisfied", () => {
        const missing = missingRequiredFields(INTAKE_PROFILES["membership-initial"], {
            addressLine1: "1 Main St",
            emergencyContacts: [{ conflictParticipantId: null, name: "Aunt May", phone: "555-2000" }],
            primaryName: "Primary",
        });
        expect(missing).toEqual([]);
    });

    it("program-first-time: age-gated enrollee without DOB fails participantDob; none age-gated passes", () => {
        const ctx = {
            emergencyContacts: [{ conflictParticipantId: null, name: "Aunt", phone: "555-2000" }],
            primaryName: "Parent",
        };
        expect(
            missingRequiredFields(INTAKE_PROFILES["program-first-time"], {
                ...ctx,
                participants: [{ ageGated: true, dob: null }],
            }).map((m) => m.field),
        ).toEqual(["participantDob"]);
        expect(
            missingRequiredFields(INTAKE_PROFILES["program-first-time"], {
                ...ctx,
                participants: [{ ageGated: false, dob: null }],
            }),
        ).toEqual([]);
    });
});
