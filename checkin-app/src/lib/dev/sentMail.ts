import prisma from "@/lib/prisma";
import { config } from "@/lib/config";

/**
 * Dev-instance sent-mail capture (EMAIL_DEV_MOCK.md).
 *
 * When there is no RESEND_API_KEY, sendEmail persists what it would have sent here instead of
 * dropping it, so link/token-bearing flows can be completed and verified in dev/local without a
 * real key. Retrievable at /dev/sent-mail. Dead in prod by construction — the only caller
 * (sendEmail) gates this on `config.devToolsActive()` (CHECKIN_ENV, fails safe to prod),
 * and these helpers additionally no-op in prod.
 */

export interface SentEmail {
    id: number;
    from: string;
    to: string;
    subject: string;
    html: string;
    createdAt: Date;
}

/**
 * Persist a captured email and report success.
 *
 * Returns true when the row is written (so gating callers — e.g. postEventEmails —
 * follow the same happy-path they'd take on a real delivery), and false if the insert throws
 * (mirroring a real send failure, so a broken dev DB isn't masked as a successful send).
 */
export async function captureSentEmail(
    from: string,
    to: string,
    subject: string,
    html: string,
): Promise<boolean> {
    try {
        await prisma.devSentEmail.create({ data: { from, to, subject, html } });
        return true;
    } catch (e) {
        console.error("[dev-email] failed to capture", e);
        return false;
    }
}

/** Most-recent captured emails (newest first) for the /dev/sent-mail view. */
export async function recentSentEmails(limit = 100): Promise<SentEmail[]> {
    if (config.isProd()) return [];
    try {
        return await prisma.devSentEmail.findMany({
            orderBy: { createdAt: "desc" },
            take: limit,
        });
    } catch (e) {
        console.error("[dev-email] failed to read", e);
        return [];
    }
}

/** Empty the capture table (the "Clear" button on /dev/sent-mail). No-op in prod. */
export async function clearSentEmails(): Promise<void> {
    if (config.isProd()) return;
    await prisma.devSentEmail.deleteMany({});
}
