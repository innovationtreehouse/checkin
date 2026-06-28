import { baseEmailLayout, escapeHtml } from './base';

interface RegistrationConfirmParams {
    programName: string;
    confirmUrl: string;
}

/**
 * Double-opt-in email: nothing is enrolled until the recipient clicks through.
 * This is the ONLY email an unconfirmed (possibly attacker-supplied) address can
 * trigger, which is why it's a single, plain confirmation rather than a cascade.
 */
export function registrationConfirmTemplate({ programName, confirmUrl }: RegistrationConfirmParams): string {
    return baseEmailLayout(`
        <h2 style="color: #6366f1;">Confirm your registration</h2>
        <p>You're almost done registering for <strong>${escapeHtml(programName)}</strong>.</p>
        <p>Click the button below to confirm. This link expires in 24 hours.</p>
        <p style="margin: 24px 0;">
            <a href="${escapeHtml(confirmUrl)}" style="background: #6366f1; color: #fff; padding: 12px 20px; border-radius: 6px; text-decoration: none; display: inline-block;">Confirm registration</a>
        </p>
        <p style="color: #6b7280; font-size: 13px;">If you didn't request this, you can safely ignore this email — nothing was created.</p>
    `);
}
