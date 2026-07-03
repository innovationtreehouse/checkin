import { validateContact } from "../contact";

describe("validateContact", () => {
    it("requires at least one of phone/email", () => {
        expect(validateContact({})).toEqual({ error: expect.any(String) });
        expect(validateContact({ phone: "  ", email: " " })).toEqual({ error: expect.any(String) });
    });

    it("rejects a malformed email", () => {
        expect("error" in validateContact({ email: "nope" })).toBe(true);
        expect("error" in validateContact({ email: "a@b" })).toBe(true);
    });

    it("rejects a too-short phone", () => {
        expect("error" in validateContact({ phone: "555-0100" })).toBe(true); // 7 digits
    });

    it("rejects an over-long phone (11 non-1-lead, 12 digits)", () => {
        expect("error" in validateContact({ phone: "25555501000" })).toBe(true); // 11 digits, no leading 1
        expect("error" in validateContact({ phone: "555555010012" })).toBe(true); // 12 digits
    });

    it("accepts 11 digits with a leading US country code", () => {
        expect(validateContact({ phone: "15555550100" })).toEqual({ phone: "15555550100", email: null });
    });

    it("returns trimmed phone/email, null for the missing one", () => {
        expect(validateContact({ phone: "  555-555-0100 " })).toEqual({ phone: "555-555-0100", email: null });
        expect(validateContact({ email: "jane@example.com" })).toEqual({ phone: null, email: "jane@example.com" });
        expect(validateContact({ phone: "5555550100", email: "jane@example.com" })).toEqual({
            phone: "5555550100",
            email: "jane@example.com",
        });
    });
});
