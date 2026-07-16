import {
    pickAddress,
    isAddressEmpty,
    normalizeAddressInput,
    isValidState,
    isValidZip,
    validateAddress,
    assertValidAddress,
    AddressValidationError,
    formatAddress,
    STATE_ERROR,
    ZIP_ERROR,
} from "@/lib/address";

describe("pickAddress", () => {
    it("returns all-null for null/undefined src", () => {
        expect(pickAddress(null)).toEqual({ line1: null, line2: null, city: null, state: null, postalCode: null });
        expect(pickAddress(undefined)).toEqual({ line1: null, line2: null, city: null, state: null, postalCode: null });
    });
    it("passes through a partial src and nulls the rest", () => {
        expect(pickAddress({ line1: "1 A St", city: "Austin" })).toEqual({
            line1: "1 A St", line2: null, city: "Austin", state: null, postalCode: null,
        });
    });
    it("passes through a full src", () => {
        const full = { line1: "1 A St", line2: "Apt 2", city: "Austin", state: "TX", postalCode: "78701" };
        expect(pickAddress(full)).toEqual(full);
    });
});

describe("isAddressEmpty", () => {
    it("true when every component is blank/whitespace-only", () => {
        expect(isAddressEmpty({ line1: " ", line2: "", city: null, state: undefined, postalCode: "  " })).toBe(true);
    });
    it("true for null/undefined input", () => {
        expect(isAddressEmpty(null)).toBe(true);
        expect(isAddressEmpty(undefined)).toBe(true);
    });
    it("false when one field is non-blank", () => {
        expect(isAddressEmpty({ line1: "1 A St" })).toBe(false);
    });
});

describe("normalizeAddressInput", () => {
    it("only returns keys present on input (partial-update semantics)", () => {
        const out = normalizeAddressInput({ line1: " 1 A St " });
        expect(out).toEqual({ line1: "1 A St" });
        expect("city" in out).toBe(false);
    });
    it("coerces a non-string raw value via String()", () => {
        expect(normalizeAddressInput({ postalCode: 78701 as unknown as string })).toEqual({ postalCode: "78701" });
    });
    it("uppercases state", () => {
        expect(normalizeAddressInput({ state: "tx" })).toEqual({ state: "TX" });
    });
    it("turns empty-after-trim or null into null (explicit undefined is treated as absent)", () => {
        expect(normalizeAddressInput({ city: "   " })).toEqual({ city: null });
        expect(normalizeAddressInput({ city: null })).toEqual({ city: null });
        expect(normalizeAddressInput({ city: undefined as unknown as string })).toEqual({});
    });
});

describe("isValidState", () => {
    it("accepts valid codes, case-insensitively and trimmed", () => {
        expect(isValidState("TX")).toBe(true);
        expect(isValidState("tx")).toBe(true);
        expect(isValidState(" CA ")).toBe(true);
    });
    it("rejects invalid/blank/null/undefined", () => {
        expect(isValidState("XX")).toBe(false);
        expect(isValidState("")).toBe(false);
        expect(isValidState(null)).toBe(false);
        expect(isValidState(undefined)).toBe(false);
    });
});

describe("isValidZip", () => {
    it("accepts 5-digit and ZIP+4 (dashed or bare 9)", () => {
        expect(isValidZip("78701")).toBe(true);
        expect(isValidZip("78701-1234")).toBe(true);
        expect(isValidZip("787011234")).toBe(true);
    });
    it("rejects too short, too long, non-digit, blank, null/undefined", () => {
        expect(isValidZip("1234")).toBe(false);
        expect(isValidZip("1234567890")).toBe(false);
        expect(isValidZip("abcde")).toBe(false);
        expect(isValidZip("")).toBe(false);
        expect(isValidZip(null)).toBe(false);
        expect(isValidZip(undefined)).toBe(false);
    });
});

describe("validateAddress", () => {
    it("reports each required field missing independently", () => {
        expect(validateAddress({ city: "Austin", state: "TX", postalCode: "78701" }).line1).toBe("Street address is required.");
        expect(validateAddress({ line1: "1 A St", state: "TX", postalCode: "78701" }).city).toBe("City is required.");
        expect(validateAddress({ line1: "1 A St", city: "Austin", postalCode: "78701" }).state).toBe("State is required.");
        expect(validateAddress({ line1: "1 A St", city: "Austin", state: "TX" }).postalCode).toBe("ZIP is required.");
    });
    it("reports the format error when state/postalCode are present but invalid", () => {
        const errors = validateAddress({ line1: "1 A St", city: "Austin", state: "XX", postalCode: "12" });
        expect(errors.state).toBe(STATE_ERROR);
        expect(errors.postalCode).toBe(ZIP_ERROR);
    });
    it("returns no errors for a fully valid address", () => {
        expect(validateAddress({ line1: "1 A St", city: "Austin", state: "TX", postalCode: "78701" })).toEqual({});
    });
});

describe("assertValidAddress", () => {
    it("throws AddressValidationError with the first error (line1 wins over later fields)", () => {
        expect(() => assertValidAddress({ city: "Austin", state: "XX", postalCode: "12" }))
            .toThrow(AddressValidationError);
        try {
            assertValidAddress({ city: "Austin", state: "XX", postalCode: "12" });
            fail("expected throw");
        } catch (e) {
            expect(e).toBeInstanceOf(AddressValidationError);
            expect((e as Error).message).toBe("Street address is required.");
        }
    });
    it("does not throw for a valid address", () => {
        expect(() => assertValidAddress({ line1: "1 A St", city: "Austin", state: "TX", postalCode: "78701" })).not.toThrow();
    });
});

describe("formatAddress", () => {
    it("returns empty string for null/undefined", () => {
        expect(formatAddress(null)).toBe("");
        expect(formatAddress(undefined)).toBe("");
    });
    it("formats a full address", () => {
        expect(formatAddress({ line1: "1 A St", line2: "Apt 2", city: "Austin", state: "TX", postalCode: "78701" }))
            .toBe("1 A St, Apt 2, Austin, TX 78701");
    });
    it("skips a missing line2 without a stray comma", () => {
        expect(formatAddress({ line1: "1 A St", line2: null, city: "Austin", state: "TX", postalCode: "78701" }))
            .toBe("1 A St, Austin, TX 78701");
    });
    it("skips missing city/state/zip pieces without stray separators", () => {
        expect(formatAddress({ line1: "1 A St", state: "TX", postalCode: "78701" })).toBe("1 A St, TX 78701");
        expect(formatAddress({ line1: "1 A St", city: "Austin" })).toBe("1 A St, Austin");
        expect(formatAddress({ line1: "1 A St" })).toBe("1 A St");
    });
});
