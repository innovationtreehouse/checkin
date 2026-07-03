import { isValidPhone, normalizePhone, formatPhone, assertValidPhone, PhoneValidationError } from "@/lib/phone";

describe("normalizePhone", () => {
    it("strips all non-digits", () => {
        expect(normalizePhone("(555) 123-4567")).toBe("5551234567");
        expect(normalizePhone("+1 555.123.4567")).toBe("15551234567");
        expect(normalizePhone(null)).toBe("");
        expect(normalizePhone(undefined)).toBe("");
    });
});

describe("isValidPhone", () => {
    it("accepts 10-digit US numbers in any format", () => {
        expect(isValidPhone("5551234567")).toBe(true);
        expect(isValidPhone("(555) 123-4567")).toBe(true);
        expect(isValidPhone("555.123.4567")).toBe(true);
    });

    it("accepts 11 digits with leading country code 1", () => {
        expect(isValidPhone("15551234567")).toBe(true);
        expect(isValidPhone("+1 (555) 123-4567")).toBe(true);
    });

    it("rejects too few / too many digits, junk, and blanks", () => {
        expect(isValidPhone("123")).toBe(false);
        expect(isValidPhone("555123456")).toBe(false); // 9 digits
        expect(isValidPhone("1555123456")).toBe(false); // 10 digits, area code can't start with 1
        expect(isValidPhone("0551234567")).toBe(false); // 10 digits, area code can't start with 0
        expect(isValidPhone("25551234567")).toBe(false); // 11 digits, wrong country code
        expect(isValidPhone("123456789012")).toBe(false); // 12 digits
        expect(isValidPhone("not a phone")).toBe(false);
        expect(isValidPhone("")).toBe(false);
        expect(isValidPhone(null)).toBe(false);
        expect(isValidPhone(undefined)).toBe(false);
    });
});

describe("formatPhone", () => {
    it("renders 10 digits in any format as xxx-xxx-xxxx", () => {
        expect(formatPhone("5551234567")).toBe("555-123-4567");
        expect(formatPhone("(555) 123-4567")).toBe("555-123-4567");
        expect(formatPhone("555.123.4567")).toBe("555-123-4567");
    });

    it("drops a leading country code", () => {
        expect(formatPhone("15551234567")).toBe("555-123-4567");
        expect(formatPhone("+1 (555) 123-4567")).toBe("555-123-4567");
    });

    it("leaves unrecognizable / partial values trimmed but unchanged", () => {
        expect(formatPhone("555123")).toBe("555123");
        expect(formatPhone("  ext 7 ")).toBe("ext 7");
        expect(formatPhone("")).toBe("");
        expect(formatPhone(null)).toBe("");
        expect(formatPhone(undefined)).toBe("");
    });
});

describe("assertValidPhone", () => {
    it("throws PhoneValidationError on invalid, passes on valid", () => {
        expect(() => assertValidPhone("5551234567")).not.toThrow();
        expect(() => assertValidPhone("bad")).toThrow(PhoneValidationError);
    });
});
