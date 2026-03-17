import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { processPostEventEmails } from "@/lib/postEventEmails";
import { processVisitCheckout } from "@/lib/attendanceTransitions";

export async function GET(req: Request) {
    const authHeader = req.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const now = new Date();

        // 1. Find all users who are currently checked in (abandoned visits)
        const abandonedVisits = await prisma.visit.findMany({
            where: {
                departed: null
            },
            include: {
                participant: true
            }
        });

        let checkedOutCount = 0;
        let boardNotified = false;

        if (abandonedVisits.length > 0) {
            // Force everybody out
            for (const visit of abandonedVisits) {
                await processVisitCheckout(visit.id, now);
                checkedOutCount++;
            }

            // If at least one was a keyholder, the facility was left "Open". We need to alert the board.
            const abandonedKeyholders = abandonedVisits.filter(v => v.participant.keyholder);
            
            if (abandonedKeyholders.length > 0) {
                const boardMembers = await prisma.participant.findMany({
                    where: { boardMember: true },
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
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        newData: { message: `Auto-closed facility at midnight. Abandoned keyholders: ${keyholderNames}` } as any
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

    } catch (error) {
        console.error("Failed to run nightly cron:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
