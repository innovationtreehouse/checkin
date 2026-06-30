import { NextResponse } from "next/server";
import { withCron } from "@/lib/cronAuth";
import prisma from "@/lib/prisma";
import { processPostEventEmails } from "@/lib/postEventEmails";
import { processVisitCheckout } from "@/lib/attendanceTransitions";

export const GET = withCron(async () => {
        const now = new Date();

        // 1. Find all users who are currently checked in (abandoned visits)
        const abandonedVisits = await prisma.visit.findMany({
            where: {
                departedAt: null
            },
            include: {
                participant: true
            }
        });

        let checkedOutCount = 0;
        let boardNotified = false;

        if (abandonedVisits.length > 0) {
            // Force everybody out concurrently. One bad checkout must not abort the rest.
            const results = await Promise.allSettled(
                abandonedVisits.map((visit) => processVisitCheckout(visit.id, now, undefined, "SYSTEM"))
            );
            results.forEach((result, i) => {
                if (result.status === "fulfilled") {
                    checkedOutCount += 1;
                } else {
                    const visit = abandonedVisits[i];
                    console.error(`Failed to check out visit ${visit.id} (participant ${visit.participant.email}):`, result.reason);
                }
            });

            // If at least one was a isKeyholder, the facility was left "Open". We need to alert the board.
            const abandonedKeyholders = abandonedVisits.filter(v => v.participant.isKeyholder);
            
            if (abandonedKeyholders.length > 0) {
                const boardMembers = await prisma.participant.findMany({
                    where: { isBoardMember: true },
                    select: { email: true }
                });

                const keyholderNames = abandonedKeyholders.map(v => v.participant.name || v.participant.email).join(', ');

                // System Audit Log for the violation
                await prisma.auditLog.create({
                    data: {
                        actorId: 0, 
                        action: 'CREATE',
                        tableName: 'SYSTEM_NOTIFY',
                        affectedEntityId: 0,
                        newData: { message: `Auto-closed facility at midnight. Abandoned keyholders: ${keyholderNames}` } as unknown as never
                    }
                });

                console.log(`CRITICAL NOTIFICATION TO BOARD MEMBERS (${boardMembers.map(m => m.email).join(', ')}):`);
                console.log(`Facility was auto-closed by the nightly cron. The following keyholders failed to badge out: ${keyholderNames}`);
                
                boardNotified = true;
            }
        }

        // 2. Process all pending post-event emails immediately, regardless of 1-hour delay
        const emailResult = await processPostEventEmails({ forceImmediate: true });

        return NextResponse.json({ 
            success: true, 
            facilityClose: {
                checkedOutCount,
                boardNotified
            },
            postEvents: emailResult
        });
});
