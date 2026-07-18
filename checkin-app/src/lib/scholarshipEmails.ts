import { sendEmail } from "@/lib/email";
import { emailBoardMembers } from "@/lib/emailRecipients";
import type { HouseholdRecipient as ScholarshipRecipient } from "@/lib/emailRecipients";
import { parseEmailHeaderList } from "@/lib/emailHeader";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";

/**
 * Scholarship / payment-plan notification helpers. Small, dependency-light
 * (prisma + email + emailRecipients + emailHeader + logger only), mirroring
 * the contract of emailRecipients.ts: callers build their own subject/html;
 * these helpers only resolve recipients / gate / fan out and swallow
 * send/query errors.
 *
 * An applicant receives exactly ONE automatic email: the request
 * acknowledgement (`sendScholarshipAck`, ungated). Board decisions (program
 * approve/deny, membership approve) are communicated manually by the
 * Scholarship Review Team, not by an automated status email — see
 * docs/PROGRAM_CAPACITY_AND_SCHOLARSHIPS.md §5.
 */

export type { HouseholdRecipient as ScholarshipRecipient } from "@/lib/emailRecipients";
export { resolveHouseholdRecipients as resolveScholarshipRecipients } from "@/lib/emailRecipients";

/** Announce a request to the Scholarship Review Team: configured address list, else all board members. */
export async function notifyReviewTeam(subject: string, html: string, errorLabel: string): Promise<void> {
    try {
        const settings = await prisma.boardSettings.findUnique({ where: { id: 1 }, select: { scholarshipNotifyEmail: true } });
        const list = settings?.scholarshipNotifyEmail ? parseEmailHeaderList(settings.scholarshipNotifyEmail) : null;
        if (list && list.length) {
            await Promise.all(list.map((to) => sendEmail(to, subject, html)));
            return;
        }
        await emailBoardMembers(subject, html, errorLabel); // UNSET (or unparseable) → board is the review team
    } catch (e) {
        logger.error(errorLabel, e);
    }
}

/** ACK — transactional, UNGATED: every resolved recipient. The applicant's only automatic email. */
export async function sendScholarshipAck(recipients: ScholarshipRecipient[], subject: string, html: string): Promise<void> {
    await Promise.all(recipients.map((r) => sendEmail(r.email, subject, html)));
}
