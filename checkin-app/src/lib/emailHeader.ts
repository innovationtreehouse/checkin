/**
 * Validate an email From/Reply-To header value: a bare address (`a@b.co`) or a
 * display-name form (`Name <a@b.co>`) — the two shapes Resend accepts. Rejects
 * anything without a plausible address so a typo can't silently break (From) or
 * misroute (Reply-To) all mail.
 *
 * Zero imports on purpose: shared by the server route (authoritative) and the
 * client settings form (UX), so the two validations can never drift.
 */
export function isValidEmailHeader(value: string): boolean {
    const angle = value.match(/<([^>]*)>\s*$/);
    const addr = (angle ? angle[1] : value).trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr);
}
