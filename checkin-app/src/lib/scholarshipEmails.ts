import { sendEmail } from "@/lib/email";
import { emailBoardMembers } from "@/lib/emailRecipients";
import type { HouseholdRecipient as ScholarshipRecipient } from "@/lib/emailRecipients";
import { parseEmailHeaderList } from "@/lib/emailHeader";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { escapeHtml } from "@/lib/email-templates/base";

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

export const DEFAULT_ACK_SUBJECT = "We received your scholarship / payment-plan request";
export const DEFAULT_ACK_MEMBERSHIP_BODY =
    "Hi — we've received your household's scholarship / payment-plan request for your Treehouse membership dues. "
    + "The Scholarship Review Team will review it and follow up.";
export const DEFAULT_ACK_PROGRAM_BODY =
    "Hi — we've received your scholarship / payment-plan request for {{programName}}. "
    + "The Scholarship Review Team will review it and follow up. Your spot is held while they do.";

/**
 * Render a plain-text ACK template into email-safe HTML: escape first (so a
 * `{{programName}}` value — or the template itself — can never inject markup),
 * substitute `{{programName}}` with its escaped value, then split on line
 * breaks into `<p>` paragraphs (blank lines dropped). Deliberately NOT an
 * HTML-authoring surface — no dangerouslySetInnerHTML, no preview iframe (see
 * the outreach template's sandboxed-iframe preview, settings/outreach/page.tsx,
 * for the XSS history this avoids by construction).
 */
export function renderAckBody(template: string, vars: { programName?: string } = {}): string {
    const escaped = escapeHtml(template).replaceAll("{{programName}}", escapeHtml(vars.programName ?? ""));
    return escaped
        .split(/\r\n|\r|\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => `<p>${line}</p>`)
        .join("");
}

type AckSettings = {
    scholarshipAckSubject?: string | null;
    scholarshipAckMembershipBody?: string | null;
    scholarshipAckProgramBody?: string | null;
} | null | undefined;

/**
 * Resolve the ACK subject + body for one send variant, falling back to the
 * default copy when the configured value is unset or blank/whitespace.
 * `variant: "membership"` renders no tokens; `"program"` substitutes
 * `{{programName}}`. Callers needing the hard-coded Shopify-failure copy
 * build that body themselves — it deliberately bypasses this resolver.
 */
export function resolveAckCopy(
    settings: AckSettings,
    variant: "membership" | "program",
    vars: { programName?: string } = {},
): { subject: string; body: string } {
    const subjectRaw = settings?.scholarshipAckSubject?.trim();
    const subject = subjectRaw || DEFAULT_ACK_SUBJECT;

    const bodyTemplateRaw = variant === "membership" ? settings?.scholarshipAckMembershipBody : settings?.scholarshipAckProgramBody;
    const bodyTemplate = bodyTemplateRaw?.trim()
        ? bodyTemplateRaw
        : (variant === "membership" ? DEFAULT_ACK_MEMBERSHIP_BODY : DEFAULT_ACK_PROGRAM_BODY);

    return { subject, body: renderAckBody(bodyTemplate, vars) };
}

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
