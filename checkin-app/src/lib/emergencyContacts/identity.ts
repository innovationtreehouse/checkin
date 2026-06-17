/**
 * Identity normalization + matching for emergency contacts.
 *
 * The core invariant — an emergency contact must NOT be a member of the same
 * household — needs a definition of "the same person". We match on three keys,
 * any of which is sufficient: normalized phone, normalized email, normalized
 * name. These same normalizations are mirrored in the backfill migration
 * (20260612000000_emergency_contact_entity) so stored keys stay comparable.
 */

/** Strip everything but digits. `"(555) 010-0"` -> `"5550100"`. */
export function normalizePhone(phone: string | null | undefined): string {
    return (phone ?? "").replace(/\D/g, "");
}

/** Lowercase + trim; empty -> null. */
export function normalizeEmail(email: string | null | undefined): string | null {
    const e = (email ?? "").trim().toLowerCase();
    return e || null;
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
    if (a.phoneDigits && b.phoneDigits && a.phoneDigits === b.phoneDigits) return true;
    if (a.emailNorm && b.emailNorm && a.emailNorm === b.emailNorm) return true;
    if (a.nameNorm && b.nameNorm && a.nameNorm === b.nameNorm) return true;
    return false;
}
