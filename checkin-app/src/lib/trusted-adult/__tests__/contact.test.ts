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

    it("returns trimmed phone/email, null for the missing one", () => {
        expect(validateContact({ phone: "  555-555-0100 " })).toEqual({ phone: "555-555-0100", email: null });
        expect(validateContact({ email: "jane@example.com" })).toEqual({ phone: null, email: "jane@example.com" });
        expect(validateContact({ phone: "5555550100", email: "jane@example.com" })).toEqual({
            phone: "5555550100",
            email: "jane@example.com",
        });
    });
});
