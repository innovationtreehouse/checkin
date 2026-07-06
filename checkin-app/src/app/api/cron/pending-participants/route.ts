import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { withCron } from "@/lib/cronAuth";
import prisma from "@/lib/prisma";
import { withdrawAndReleaseHold } from "@/lib/program/capacity";

export const GET = withCron(async () => {
        const now = new Date();
        const pendingParticipants = await prisma.programParticipant.findMany({
            where: {
                status: 'PENDING',
                isPaymentPlanRequested: false,
                pendingSince: { not: null }
            },
            include: {
                person: true,
                program: true
            }
        });

        let kickedCount = 0;
        let warnedCount = 0;
        const toDelete: typeof pendingParticipants = [];

        for (const record of pendingParticipants) {
            if (!record.pendingSince) continue;
            
            const diffTime = Math.abs(now.getTime() - record.pendingSince.getTime());
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)); // Calculate total full days

            // Email text for warnings
            const warningText = `If not paid, your spot in ${record.program.name} will be freed up. If a payment plan is needed, contact the board via finance@innovationtreehouse.org`;

            if (diffDays >= 7) {
                // Collect for removal below (hold-ledger: a denied scholarship
                // applicant is isPaymentPlanRequested:false too, so this query can
                // also catch a still-held seat — see the per-row removal below).
                toDelete.push(record);

                kickedCount++;

                logger.info(`[CRON] Removed participant ${record.person.name} from ${record.program.name} after ${diffDays} days.`);
                logger.info(`[EMAIL DISPATCH] To: ${record.person.email}, Subject: Removed from ${record.program.name} due to non-payment`);
            } else if (diffDays === 6) {
                warnedCount++;
                logger.info(`[EMAIL DISPATCH] To: ${record.person.email}, Subject: FINAL WARNING: 24 hours left to pay for ${record.program.name}`);
                logger.info(`[EMAIL DISPATCH] Body: ${warningText}`);
            } else if (diffDays === 3) {
                warnedCount++;
                logger.info(`[EMAIL DISPATCH] To: ${record.person.email}, Subject: Please pay for ${record.program.name} within 4 days`);
                logger.info(`[EMAIL DISPATCH] Body: ${warningText}`);
            } else if (diffDays === 1) {
                warnedCount++;
                logger.info(`[EMAIL DISPATCH] To: ${record.person.email}, Subject: Reminder: Payment required for ${record.program.name}`);
                logger.info(`[EMAIL DISPATCH] Body: ${warningText}`);
            }
        }

        // Removed one row at a time (not a bulk deleteMany) so the hold-ledger
        // release (withdrawAndReleaseHold) runs per participant, and one bad row
        // can't block the rest of the sweep.
        for (const record of toDelete) {
            try {
                await withdrawAndReleaseHold(record.programId, record.personId, record.program);
            } catch (err) {
                // P2025 = already removed by another path (e.g. self-withdraw)
                // between this sweep's read and now — benign, skip.
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
