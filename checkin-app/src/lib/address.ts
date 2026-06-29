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
    console.log("address self-check OK");
}
