import prisma from "./prisma";
import { config } from "./config";

export interface EmailSenderIdentity {
    /** The Resend `from`. BoardSettings.emailFromAddress overrides the EMAIL_FROM env default. */
    from: string;
    /** The Resend `replyTo`, or undefined when the board hasn't configured one. */
    replyTo?: string;
}

/**
 * Resolve the effective sender identity for outbound mail: the board can override
 * the EMAIL_FROM env default and add a Reply-To via Settings → Membership. Falls
 * back to the env-only identity on any DB error so a settings-table hiccup never
 * blocks mail delivery.
 *
 * ponytail: one findUnique on the single-row BoardSettings PK per send. Fan-outs
 * (e.g. notifyNewProgramAnnounced) pay it per recipient; the lookup is a cached
 * PK hit and those volumes are small. If a large fan-out ever dominates, resolve
 * once and pass the identity down.
 */
export async function getEmailSenderIdentity(): Promise<EmailSenderIdentity> {
    const envFrom = config.emailFrom();
    try {
        const settings = await prisma.boardSettings.findUnique({
            where: { id: 1 },
            select: { emailFromAddress: true, emailReplyToAddress: true },
        });
        return {
            from: settings?.emailFromAddress?.trim() || envFrom,
            replyTo: settings?.emailReplyToAddress?.trim() || undefined,
        };
    } catch {
        return { from: envFrom };
    }
}
