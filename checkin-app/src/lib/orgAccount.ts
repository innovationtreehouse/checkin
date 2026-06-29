import { ORG_DOMAIN } from './config';

/**
 * True when the acting user is an internal @innovationtreehouse.org staff account
 * rather than a real member family. Prefer the verified Google hosted-domain (`hd`)
 * claim; fall back to the email suffix when `hd` isn't present (e.g. credential login).
 *
 * Used to block staff from building out a household with extra members via self-service.
 * The admin participant-add flow (sysadmin/boardMember acting on a household's behalf)
 * is deliberately NOT gated by this.
 */
export function isOrgAccount(user: { hd?: string | null; email?: string | null }): boolean {
    if (user.hd === ORG_DOMAIN) return true;
    return !!user.email && user.email.toLowerCase().endsWith(`@${ORG_DOMAIN}`);
}
