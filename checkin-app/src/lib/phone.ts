/**
 * Shared phone-number normalization + validation. One source of truth for every
 * surface that captures a phone (household members, emergency contacts, user
 * profile, public registration). Client forms use {@link isValidPhone} for inline
 * feedback; API/service write boundaries call {@link assertValidPhone} so an
 * invalid number can never be persisted regardless of the client.
 */

/** Strip everything but digits. `"(555) 010-0"` -> `"5550100"`. */
export function normalizePhone(phone: string | null | undefined): string {
    return (phone ?? "").replace(/\D/g, "");
}

/**
 * A valid US phone is exactly 10 digits, or 11 digits with a leading country
 * code of 1. Formatting characters (spaces, dashes, parens, +) are ignored, so
 * "(555) 123-4567" and "5551234567" both pass. Blank/missing fails — callers
 * that allow an optional phone must short-circuit on empty before calling.
 */
export function isValidPhone(phone: string | null | undefined): boolean {
    const d = normalizePhone(phone);
    return d.length === 10 || (d.length === 11 && d.startsWith("1"));
}

/**
 * Canonical display/storage form: `"5551234567"` / `"(555) 123-4567"` ->
 * `"555-123-4567"`. A leading US country code (11 digits, leading 1) is
 * dropped. Anything that isn't a recognizable 10/11-digit number is returned
 * trimmed-but-unchanged, so legacy/partial values render as-is instead of being
 * mangled. Write boundaries call this so the stored value is always dashed.
 */
export function formatPhone(phone: string | null | undefined): string {
    const d = normalizePhone(phone);
    const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
    if (ten.length !== 10) return (phone ?? "").trim();
    return `${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}`;
}

export const PHONE_ERROR = "Enter a valid 10-digit US phone number.";

/** Throw if invalid; for server-side trust boundaries. */
export function assertValidPhone(phone: string | null | undefined): void {
    if (!isValidPhone(phone)) throw new PhoneValidationError();
}

export class PhoneValidationError extends Error {
    constructor(message: string = PHONE_ERROR) {
        super(message);
        this.name = "PhoneValidationError";
    }
}
