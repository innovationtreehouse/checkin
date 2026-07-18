import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { withCron } from "@/lib/cronAuth";
import prisma from "@/lib/prisma";
import { withdrawAndReleaseHold } from "@/lib/program/capacity";
import { STATES } from "@/lib/programs/enrollmentState";
import { resolveHouseholdRecipients } from "@/lib/emailRecipients";
import { sendEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/email-templates/base";

/** Warning copy (day 1/3/6) — identical body across all three, only the subject escalates. */
function warningHtml(programName: string): string {
    return `<p>If not paid, your spot in <strong>${escapeHtml(programName)}</strong> will be freed up. If you need a scholarship or payment plan, request one from the program's page — the Scholarship Review Team will follow up.</p>`;
}

function removalHtml(programName: string, diffDays: number): string {
    return `<p>You have been removed from <strong>${escapeHtml(programName)}</strong> due to non-payment after ${diffDays}+ days. The seat has been released. If you still want to participate, you can re-enroll and pay, or request a scholarship or payment plan from the program's page.</p>`;
}

/** Resolve household leads ∪ participant and fan out. No household → nothing to email
 *  (person.householdId is a required column, but stays defensive here since this is
 *  the removal/warning path, not a place to let a missing recipient throw). */
async function notifyHousehold(householdId: number | null | undefined, personId: number, subject: string, html: string): Promise<void> {
    if (!householdId) return;
    const recipients = await resolveHouseholdRecipients(householdId, personId);
    // sendEmail never rejects (failures resolve to `false` and are logged internally) —
    // fire-and-forget fan-out, nothing left to catch here.
    await Promise.all(recipients.map((r) => sendEmail(r.email, subject, html)));
}

export const GET = withCron(async () => {
        const now = new Date();
        const pendingParticipants = await prisma.programParticipant.findMany({
            where: {
                // The 7-day non-payment clock owns exactly PENDING_UNPAID
                // (enrollmentState §3). Its `where` carries isPaymentPlanRequested:false,
                // which is what keeps HOLD_FAILED (req=true) and denied applicants
                // (den≠null, governed by the grace-expiry cron) out of this sweep —
                // a denial never resets pendingSince, so without that they'd be
                // kicked the night after denial.
                ...STATES.PENDING_UNPAID.where,
                pendingSince: { not: null }
            },
            include: {
                person: true,
                program: true
            }
        });

        let kickedCount = 0;
        let warnedCount = 0;
        const toDelete: Array<(typeof pendingParticipants)[number] & { diffDays: number }> = [];

        for (const record of pendingParticipants) {
            if (!record.pendingSince) continue;

            const diffTime = Math.abs(now.getTime() - record.pendingSince.getTime());
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)); // Calculate total full days

            if (diffDays >= 7) {
                // Collect for removal below (denied scholarship applicants are
                // excluded by the query above; anything caught here is an
                // ordinary non-payer, though withdrawAndReleaseHold still
                // handles a held seat correctly if one slips through).
                toDelete.push({ ...record, diffDays });
                kickedCount++;
            } else if (diffDays === 6 || diffDays === 3 || diffDays === 1) {
                warnedCount++;
                const subject = diffDays === 6
                    ? `FINAL WARNING: 24 hours left to pay for ${record.program.name}`
                    : diffDays === 3
                        ? `Please pay for ${record.program.name} within 4 days`
                        : `Reminder: Payment required for ${record.program.name}`;
                await notifyHousehold(record.person.householdId, record.personId, subject, warningHtml(record.program.name));
            }
        }

        // Removed one row at a time (not a bulk deleteMany) so the hold-ledger
        // release (withdrawAndReleaseHold) runs per participant, and one bad row
        // can't block the rest of the sweep.
        for (const record of toDelete) {
            try {
                await withdrawAndReleaseHold(record.programId, record.personId, record.program);
                logger.info(`[CRON] Removed participant ${record.person.name} from ${record.program.name} after ${record.diffDays} days.`);

                // Email only AFTER the removal is confirmed. withdrawAndReleaseHold can
                // throw (row already gone — P2025 — or a real failure that leaves the
                // row in place for next run's retry); sending before it returns would
                // lie about a removal that didn't happen.
                await notifyHousehold(
                    record.person.householdId,
                    record.personId,
                    `Removed from ${record.program.name} due to non-payment`,
                    removalHtml(record.program.name, record.diffDays),
                );
            } catch (err) {
                // P2025 = already removed by another path (e.g. self-withdraw)
                // between this sweep's read and now — benign, skip (no email either).
                if (!isPrismaP2025(err)) {
                    logger.error(`[CRON] Failed to remove pending participant ${record.personId} from program ${record.programId}:`, err);
                }
            }
        }

        return NextResponse.json({ success: true, processed: pendingParticipants.length, kicked: kickedCount, warned: warnedCount });
});

function isPrismaP2025(err: unknown): boolean {
    return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === 'P2025';
}
