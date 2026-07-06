import { Resend } from 'resend';
import { config } from './config';
import { captureSentEmail } from './dev/sentMail';
import { getEmailSenderIdentity } from './emailIdentity';

const resend = config.resendApiKey()
    ? new Resend(config.resendApiKey()!)
    : null;

/**
 * Send an email via Resend. Falls back to console.log if no API key is configured.
 *
 * The From (and optional Reply-To) come from getEmailSenderIdentity(): the board
 * can override the EMAIL_FROM env default and set a Reply-To in Settings → Membership.
 */
export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
    const { from, replyTo } = await getEmailSenderIdentity();

    if (!resend) {
        console.log(`[Email (no RESEND_API_KEY)] To: ${to} | Subject: ${subject}`);
        // Dev/local: capture the email so link/token flows are retrievable at /dev/sent-mail,
        // and report success so gating callers follow the prod happy-path. Guarded with the
        // persona-mint idiom (see auth-options.ts) so it is impossible in prod: a prod box that
        // somehow lost its key still falls through to `return false` (fail loud, not fake success).
        if (config.isDevInstance() && process.env.NODE_ENV !== 'production') {
            return captureSentEmail(from, to, subject, html);
        }
        return false;
    }

    try {
        const { error } = await resend.emails.send({
            from,
            to,
            subject,
            html,
            ...(replyTo ? { replyTo } : {}),
        });

        if (error) {
            console.error(`[Email Error] Failed to send to ${to}:`, error);
            return false;
        }

        console.log(`[Email Sent] To: ${to} | Subject: ${subject}`);
        return true;
    } catch (err) {
        console.error(`[Email Exception] Failed to send to ${to}:`, err);
        return false;
    }
}
