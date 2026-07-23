import { isValidEmail } from "./emergencyContacts/identity";

/**
 * Validate an email From/Reply-To header value: a bare address (`a@b.co`) or a
 * display-name form (`Name <a@b.co>`) — the two shapes Resend accepts. Extracts the
 * address from the angle-bracket form (the only thing a header adds over a plain
 * address) and defers to the shared `isValidEmail` so the address rule stays single-sourced.
 *
 * Shared by the server route (authoritative) and the client settings form (UX),
 * so the two validations can never drift.
 */
export function isValidEmailHeader(value: string): boolean {
    const angle = value.match(/<([^>]*)>\s*$/);
    return isValidEmail(angle ? angle[1] : value);
}

/**
 * Parse a comma-separated list of email headers (Reply-To can have more than one
 * recipient, e.g. "info@x.org, ops@x.org"). Each entry is validated with
 * isValidEmailHeader; returns the trimmed, deduplicated list, or null if the value
 * is blank or any entry is malformed (reject-the-whole-list, same as a single header).
 *
 * ponytail: splits on a bare ',' — a quoted display name containing a comma
 * (`"Smith, Jane" <jane@x.org>`) isn't supported. Add a quoted-string-aware split
 * if that ever comes up.
 */
export function parseEmailHeaderList(value: string): string[] | null {
    const parts = value.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0 || !parts.every(isValidEmailHeader)) return null;
    return Array.from(new Set(parts));
}
