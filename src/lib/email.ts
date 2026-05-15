import { Resend } from 'resend';
import { config } from './config';

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
        // SECURITY: Do not log the raw `html` body to the console in production to prevent
        // sensitive data (e.g., magic links, PII) from leaking into server logs.
        // We only allow this logging in development mode for debugging.
        if (process.env.NODE_ENV === 'development') {
            console.log(`[Email Body]: ${html}`);
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
            return false;
        }

        console.log(`[Email Sent] To: ${to} | Subject: ${subject}`);
        return true;
    } catch (err) {
        console.error(`[Email Exception] Failed to send to ${to}:`, err);
        return false;
    }
}
