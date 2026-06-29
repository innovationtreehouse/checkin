import { normalizePhone, isValidEmail } from "@/lib/emergencyContacts/identity";

export interface ContactInput {
    phone?: string | null;
    email?: string | null;
}

/**
 * Validate a trusted adult's phone/email. At least one is required; each, if
 * given, must be well-formed. Returns the trimmed values (empty -> null) ready
 * to store, or a human-facing error. Pure — called from both the client form
 * and the API.
 */
export function validateContact({ phone, email }: ContactInput):
    | { phone: string | null; email: string | null }
    | { error: string } {
    const p = (phone ?? "").trim();
    const e = (email ?? "").trim();
    if (!p && !e) return { error: "Enter a phone number or an email for the trusted adult." };
    if (e && !isValidEmail(e)) return { error: "That email address doesn't look right." };
    // ponytail: 10+ digits = a plausible US number; loosen if intl numbers appear.
    if (p && normalizePhone(p).length < 10) return { error: "That phone number doesn't look right." };
    return { phone: p || null, email: e || null };
}
