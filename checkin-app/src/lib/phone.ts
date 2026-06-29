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
