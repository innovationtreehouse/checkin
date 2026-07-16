/**
 * Structured postal address (US-only for now). Lives inline on Household and
 * Corporation as five nullable columns; this module is the one place that knows
 * how to normalize, format, and extract them.
 *
 * ponytail: US-only — `state` is a 2-letter code, no country field. Add country
 * + per-country validation when a non-US member actually needs it.
 */

export const ADDRESS_FIELDS = ["line1", "line2", "city", "state", "postalCode"] as const;
export type AddressField = (typeof ADDRESS_FIELDS)[number];

export interface StructuredAddress {
    line1: string | null;
    line2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
}

/** Pull just the address fields off a wider record (e.g. a Household row). */
export function pickAddress(src: Partial<StructuredAddress> | null | undefined): StructuredAddress {
    return {
        line1: src?.line1 ?? null,
        line2: src?.line2 ?? null,
        city: src?.city ?? null,
        state: src?.state ?? null,
        postalCode: src?.postalCode ?? null,
    };
}

/** True when every component is empty/absent. */
export function isAddressEmpty(a: Partial<StructuredAddress> | null | undefined): boolean {
    return ADDRESS_FIELDS.every((f) => !a?.[f]?.trim());
}

/**
 * Normalize caller-supplied address fields for storage. Only the keys present on
 * `input` are returned, so callers can do partial updates (`data: normalizeAddressInput(body)`).
 * Trims everything; upper-cases the 2-letter state; empty strings become null.
 */
export function normalizeAddressInput(input: Partial<Record<AddressField, unknown>>): Partial<StructuredAddress> {
    const out: Partial<StructuredAddress> = {};
    for (const f of ADDRESS_FIELDS) {
        if (input[f] === undefined) continue;
        const raw = input[f];
        let v = raw == null ? "" : String(raw).trim();
        if (f === "state") v = v.toUpperCase();
        out[f] = v === "" ? null : v;
    }
    return out;
}

/** The 50 states + DC. Source of truth for the 2-letter `state` check. */
const US_STATES = new Set([
    "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
    "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
    "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
    "VA","WA","WV","WI","WY","DC",
]);

export const STATE_ERROR = "Enter a valid 2-letter state code (e.g. TX).";
export const ZIP_ERROR = "Enter a valid ZIP (5 digits, or 9 as 12345-6789).";

/** Valid US state abbreviation (case-insensitive). */
export function isValidState(state: string | null | undefined): boolean {
    return US_STATES.has((state ?? "").trim().toUpperCase());
}

/** 5-digit ZIP or ZIP+4 ("12345" or "12345-6789"; bare 9 digits also ok). */
export function isValidZip(zip: string | null | undefined): boolean {
    return /^\d{5}(?:-?\d{4})?$/.test((zip ?? "").trim());
}

/**
 * Validate a full address for the household form. line1/city/state/postalCode are
 * required; line2 is optional. Returns a per-field error map ({} when valid) so a
 * client can render inline messages. Shared by the API write boundary via
 * {@link assertValidAddress}.
 */
export function validateAddress(a: Partial<StructuredAddress> | null | undefined): Partial<Record<AddressField, string>> {
    const errors: Partial<Record<AddressField, string>> = {};
    if (!a?.line1?.trim()) errors.line1 = "Street address is required.";
    if (!a?.city?.trim()) errors.city = "City is required.";
    if (!a?.state?.trim()) errors.state = "State is required.";
    else if (!isValidState(a.state)) errors.state = STATE_ERROR;
    if (!a?.postalCode?.trim()) errors.postalCode = "ZIP is required.";
    else if (!isValidZip(a.postalCode)) errors.postalCode = ZIP_ERROR;
    return errors;
}

export class AddressValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "AddressValidationError";
    }
}

/** Throw on first error; for server-side trust boundaries. */
export function assertValidAddress(a: Partial<StructuredAddress> | null | undefined): void {
    const errors = validateAddress(a);
    const first = Object.values(errors)[0];
    if (first) throw new AddressValidationError(first);
}

/** Single-line display, skipping blank components. e.g. "123 Main St, Apt 2, Austin, TX 78701". */
export function formatAddress(a: Partial<StructuredAddress> | null | undefined): string {
    if (!a) return "";
    const cityStateZip = [a.city?.trim(), [a.state?.trim(), a.postalCode?.trim()].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(", ");
    return [a.line1?.trim(), a.line2?.trim(), cityStateZip].filter(Boolean).join(", ");
}

// ponytail: one runnable self-check, not a suite. `npx tsx src/lib/address.ts`.
if (process.argv[1] && process.argv[1].endsWith("address.ts")) {
    const assert = (c: boolean, m: string) => { if (!c) throw new Error("address self-check: " + m); };
    const n = normalizeAddressInput({ line1: " 1 A St ", state: "tx", city: "", postalCode: "78701" });
    assert(n.line1 === "1 A St", "trim line1");
    assert(n.state === "TX", "upper state");
    assert(n.city === null, "empty -> null");
    assert(!("line2" in n), "absent key stays absent");
    assert(formatAddress({ line1: "1 A St", line2: null, city: "Austin", state: "TX", postalCode: "78701" }) === "1 A St, Austin, TX 78701", "format skips blanks");
    assert(formatAddress({ line1: "1 A St", line2: "Apt 2", city: "Austin", state: "TX", postalCode: "78701" }) === "1 A St, Apt 2, Austin, TX 78701", "format full");
    assert(isAddressEmpty({ line1: " ", state: null }), "empty detection");
    assert(!isAddressEmpty({ line1: "x" }), "non-empty detection");
    assert(isValidState("tx") && isValidState(" CA "), "valid state");
    assert(!isValidState("XX") && !isValidState(""), "invalid state");
    assert(isValidZip("78701") && isValidZip("78701-1234") && isValidZip("787011234"), "valid zip");
    assert(!isValidZip("1234") && !isValidZip("abcde") && !isValidZip(""), "invalid zip");
    const good = validateAddress({ line1: "1 A St", city: "Austin", state: "TX", postalCode: "78701" });
    assert(Object.keys(good).length === 0, "full address valid");
    const bad = validateAddress({ line1: "", city: "Austin", state: "XX", postalCode: "12" });
    assert(!!bad.line1 && bad.state === STATE_ERROR && bad.postalCode === ZIP_ERROR, "errors reported");
    let threw = false;
    try { assertValidAddress({ line1: "1 A St", city: "Austin", state: "TX", postalCode: "bad" }); } catch { threw = true; }
    assert(threw, "assert throws on invalid");
    console.log("address self-check OK");
}
