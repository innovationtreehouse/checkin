import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { withCron } from "@/lib/cronAuth";
import prisma from "@/lib/prisma";

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
        const toDelete: { programId: number; personId: number }[] = [];

        for (const record of pendingParticipants) {
            if (!record.pendingSince) continue;
            
            const diffTime = Math.abs(now.getTime() - record.pendingSince.getTime());
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)); // Calculate total full days

            // Email text for warnings
            const warningText = `If not paid, your spot in ${record.program.name} will be freed up. If a payment plan is needed, contact the board via finances@innovationtreehouse.org`;

            if (diffDays >= 7) {
                // Collect IDs for batch deletion
                toDelete.push({
                    programId: record.programId,
                    personId: record.personId
                });

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

        if (toDelete.length > 0) {
            await prisma.programParticipant.deleteMany({
                where: {
                    OR: toDelete
                }
            });
        }

        return NextResponse.json({ success: true, processed: pendingParticipants.length, kicked: kickedCount, warned: warnedCount });
});
