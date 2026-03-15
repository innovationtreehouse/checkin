import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(req: Request) {
    const authHeader = req.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const now = new Date();
        const pendingParticipants = await prisma.programParticipant.findMany({
            where: {
                status: 'PENDING',
                paymentPlanRequested: false,
                pendingSince: { not: null }
            },
            include: {
                participant: true,
                program: true
            }
        });

        let kickedCount = 0;
        let warnedCount = 0;

        for (const record of pendingParticipants) {
            if (!record.pendingSince) continue;
            
            const diffTime = Math.abs(now.getTime() - record.pendingSince.getTime());
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)); // Calculate total full days

            // Email text for warnings
            const warningText = `If not paid, your spot in ${record.program.name} will be freed up. If a payment plan is needed, contact the board via finances@innovationtreehouse.org`;

            if (diffDays >= 7) {
                // Delete the participant
                await prisma.programParticipant.delete({
                    where: {
                        programId_participantId: {
                            programId: record.programId,
                            participantId: record.participantId
                        }
                    }
                });

                kickedCount++;

                console.log(`[CRON] Removed participant ${record.participant.name} from ${record.program.name} after ${diffDays} days.`);
                console.log(`[EMAIL DISPATCH] To: ${record.participant.email}, Subject: Removed from ${record.program.name} due to non-payment`);
            } else if (diffDays === 6) {
                warnedCount++;
                console.log(`[EMAIL DISPATCH] To: ${record.participant.email}, Subject: FINAL WARNING: 24 hours left to pay for ${record.program.name}`);
                console.log(`[EMAIL DISPATCH] Body: ${warningText}`);
            } else if (diffDays === 3) {
                warnedCount++;
                console.log(`[EMAIL DISPATCH] To: ${record.participant.email}, Subject: Please pay for ${record.program.name} within 4 days`);
                console.log(`[EMAIL DISPATCH] Body: ${warningText}`);
            } else if (diffDays === 1) {
                warnedCount++;
                console.log(`[EMAIL DISPATCH] To: ${record.participant.email}, Subject: Reminder: Payment required for ${record.program.name}`);
                console.log(`[EMAIL DISPATCH] Body: ${warningText}`);
            }
        }

        return NextResponse.json({ success: true, processed: pendingParticipants.length, kicked: kickedCount, warned: warnedCount });
    } catch (error) {
        console.error("Cron script error:", error);
        return NextResponse.json({ error: "Cron Failed" }, { status: 500 });
    }
}
