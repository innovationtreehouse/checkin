import { Resend } from 'resend';
import { config } from './config';
import { captureSentEmail } from './dev/sentMail';
import { logIntegrationError } from './logger';

const resend = config.resendApiKey()
    ? new Resend(config.resendApiKey()!)
    : null;

const FROM_ADDRESS = config.emailFrom();

/**
 * Send an email via Resend. Falls back to console.log if no API key is configured.
 */
export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
    if (!resend) {
        console.log(`[Email (no RESEND_API_KEY)] To: ${to} | Subject: ${subject}`);
        // Dev/local: capture the email so link/token flows are retrievable at /dev/sent-mail,
        // and report success so gating callers follow the prod happy-path. Guarded with the
        // persona-mint idiom (see auth-options.ts) so it is impossible in prod: a prod box that
        // somehow lost its key still falls through to `return false` (fail loud, not fake success).
        if (config.isDevInstance() && process.env.NODE_ENV !== 'production') {
            return captureSentEmail(FROM_ADDRESS, to, subject, html);
        }
        return false;
    }

    try {
        const { error } = await resend.emails.send({
            from: FROM_ADDRESS,
            to,
            subject,
            html,
        });

        if (error) {
            console.error(`[Email Error] Failed to send to ${to}:`, error);
            // System Status > Link Status tab (see logIntegrationError). Deliberately no
            // `html` in context — log-hygiene contract asserted in email.test.ts.
            await logIntegrationError('email', error.message, { to, subject });
            return false;
        }

        console.log(`[Email Sent] To: ${to} | Subject: ${subject}`);
        return true;
    } catch (err) {
        console.error(`[Email Exception] Failed to send to ${to}:`, err);
        await logIntegrationError('email', err, { to, subject });
        return false;
    }
}
