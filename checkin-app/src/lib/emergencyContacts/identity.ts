/**
 * Identity normalization + matching for emergency contacts.
 *
 * The core invariant — an emergency contact must NOT be a member of the same
 * household — needs a definition of "the same person". We match on three keys,
 * any of which is sufficient: normalized phone, normalized email, normalized
 * name. These same normalizations are mirrored in the backfill migration
 * (20260612000000_emergency_contact_entity) so stored keys stay comparable.
 */

/** Strip everything but digits. Shared with the app-wide phone validator. */
import { normalizePhone } from "@/lib/phone";
export { normalizePhone };

/** Lowercase + trim; empty -> null. */
export function normalizeEmail(email: string | null | undefined): string | null {
    const e = (email ?? "").trim().toLowerCase();
    return e || null;
}

// ponytail: shallow shape check, not deliverability. Good enough for a contact
// field a human reads; swap for a real validator only if bounce rate matters.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** True if the (trimmed) string looks like a well-formed email address. */
export function isValidEmail(email: string | null | undefined): boolean {
    return EMAIL_RE.test((email ?? "").trim());
}

/** Lowercase, trim, collapse internal whitespace; empty -> "". */
export function normalizeName(name: string | null | undefined): string {
    return (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export interface IdentityKeys {
    phoneDigits: string;
    emailNorm: string | null;
    nameNorm: string;
}

export function identityKeys(person: { name?: string | null; phone?: string | null; email?: string | null }): IdentityKeys {
    return {
        phoneDigits: normalizePhone(person.phone),
        emailNorm: normalizeEmail(person.email),
        nameNorm: normalizeName(person.name),
    };
}

/**
 * True when two people are the same identity: any of phone / email / name match
 * on a non-empty value. Name-only matches are intentionally included per the
 * product decision (phone + email + name).
 */
export function sameIdentity(a: IdentityKeys, b: IdentityKeys): boolean {
    return identityMatchReason(a, b) !== null;
}

/** Which key matched (phone wins, then email, then name), or null. */
export function identityMatchReason(a: IdentityKeys, b: IdentityKeys): "phone" | "email" | "name" | null {
    if (a.phoneDigits && b.phoneDigits && a.phoneDigits === b.phoneDigits) return "phone";
    if (a.emailNorm && b.emailNorm && a.emailNorm === b.emailNorm) return "email";
    if (a.nameNorm && b.nameNorm && a.nameNorm === b.nameNorm) return "name";
    return null;
}
