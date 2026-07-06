import prisma from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { logger } from "@/lib/logger";

/**
 * Email fan-out helpers. Kept dependency-free (prisma + email + logger only) so
 * any path can resolve-and-send without an import cycle. Callers build their own
 * subject/html (with NEXTAUTH_URL base, escapeHtml, etc.) and pass a distinct
 * errorLabel; these helpers only resolve recipients and swallow send/query errors.
 */

/**
 * Send one email to each recipient. sendEmail never rejects (failures resolve to
 * `false` and are already persisted via logIntegrationError) — this just fans out,
 * nothing left to catch here.
 */
function fanOutEmails(emails: string[], subject: string, html: string): Promise<boolean[]> {
    return Promise.all(emails.map((email) => sendEmail(email, subject, html)));
}

/** Email every lead of a household. Resolve + fan-out; all errors logged and swallowed. */
export async function emailHouseholdLeads(householdId: number, subject: string, html: string, errorLabel: string): Promise<void> {
    try {
        const leads = await prisma.person.findMany({
            where: { householdId, isHouseholdLead: true },
            select: { email: true },
        });
        const emails = leads.map((l) => l.email).filter((e): e is string => !!e);
        await fanOutEmails(emails, subject, html);
    } catch (e) {
        logger.error(errorLabel, e);
    }
}

/** Email every board member with an address on file. Resolve + fan-out; all errors logged and swallowed. */
export async function emailBoardMembers(subject: string, html: string, errorLabel: string): Promise<void> {
    try {
        const board = await prisma.person.findMany({
            where: { isBoardMember: true, email: { not: null } },
            select: { email: true },
        });
        const emails = board.map((b) => b.email).filter((e): e is string => !!e);
        await fanOutEmails(emails, subject, html);
    } catch (e) {
        logger.error(errorLabel, e);
    }
}
