import { normalizePhone, normalizeEmail, normalizeName, isValidEmail, identityKeys, sameIdentity } from "@/lib/emergencyContacts/identity";

describe("emergency contact identity normalization", () => {
    it("strips non-digits from phones", () => {
        expect(normalizePhone("(555) 010-0")).toBe("5550100");
        expect(normalizePhone("555.010.0")).toBe("5550100");
        expect(normalizePhone(null)).toBe("");
    });

    it("lowercases/trims email, empty -> null", () => {
        expect(normalizeEmail("  Foo@Bar.COM ")).toBe("foo@bar.com");
        expect(normalizeEmail("")).toBeNull();
        expect(normalizeEmail(undefined)).toBeNull();
    });

    it("validates email shape", () => {
        expect(isValidEmail("jane@example.com")).toBe(true);
        expect(isValidEmail("  jane@example.com  ")).toBe(true);
        expect(isValidEmail("jane@example")).toBe(false);
        expect(isValidEmail("nope")).toBe(false);
        expect(isValidEmail("")).toBe(false);
        expect(isValidEmail(null)).toBe(false);
    });

    it("lowercases/trims/collapses name", () => {
        expect(normalizeName("  Jane   Doe ")).toBe("jane doe");
        expect(normalizeName(null)).toBe("");
    });
});

describe("sameIdentity", () => {
    const jane = { name: "Jane Doe", phone: "(555) 010-0", email: "jane@x.com" };

    it("matches on phone across formats", () => {
        expect(sameIdentity(identityKeys(jane), identityKeys({ name: "Other", phone: "5550100" }))).toBe(true);
    });
    it("matches on email case-insensitively", () => {
        expect(sameIdentity(identityKeys(jane), identityKeys({ name: "Other", phone: "999", email: "JANE@x.com" }))).toBe(true);
    });
    it("matches on name", () => {
        expect(sameIdentity(identityKeys(jane), identityKeys({ name: "jane doe", phone: "999" }))).toBe(true);
    });
    it("does not match unrelated people", () => {
        expect(sameIdentity(identityKeys(jane), identityKeys({ name: "Bob", phone: "999", email: "bob@x.com" }))).toBe(false);
    });
    it("ignores empty keys (two blanks are not the same person)", () => {
        expect(sameIdentity(identityKeys({ name: "", phone: "" }), identityKeys({ name: "", phone: "" }))).toBe(false);
    });
});
