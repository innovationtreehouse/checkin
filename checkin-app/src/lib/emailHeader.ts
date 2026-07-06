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
