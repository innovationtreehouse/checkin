import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { withCron } from "@/lib/cronAuth";
import prisma from "@/lib/prisma";
import { processPostEventEmails } from "@/lib/postEventEmails";
import { processVisitCheckout } from "@/lib/attendanceTransitions";
import { LIVE_PERSON } from "@/lib/person/filters";
import { LIVE_VISIT } from "@/lib/visit/filters";

export const GET = withCron(async () => {
        const now = new Date();

        // 1. Find all users who are currently checked in (abandoned visits)
        // A tombstoned open visit is not abandoned — it's deleted; closing it
        // would rewrite a record the member chose to erase.
        const abandonedVisits = await prisma.visit.findMany({
            where: {
                departedAt: null,
                ...LIVE_VISIT
            },
            include: {
                person: true
            }
        });

        let checkedOutCount = 0;
        let boardNotified = false;

        if (abandonedVisits.length > 0) {
            // Force everybody out concurrently. One bad checkout must not abort the rest.
            const results = await Promise.allSettled(
                // AUTO_CLOSE: stamped at cron-run time, so the member's real leave
                // may be hours earlier. Correcting one of these is expected by
                // construction and never flags (lib/visit/significance.ts).
                abandonedVisits.map((visit) => processVisitCheckout(visit.id, now, undefined, "AUTO_CLOSE"))
            );
            results.forEach((result, i) => {
                if (result.status === "fulfilled") {
                    checkedOutCount += 1;
                } else {
                    const visit = abandonedVisits[i];
                    logger.error(`Failed to check out visit ${visit.id} (person ${visit.person.email}):`, result.reason);
                }
            });

            // If at least one was a isKeyholder, the facility was left "Open". We need to alert the board.
            const abandonedKeyholders = abandonedVisits.filter(v => v.person.isKeyholder);
            
            if (abandonedKeyholders.length > 0) {
                const boardMembers = await prisma.person.findMany({
                    where: { isBoardMember: true, ...LIVE_PERSON },
                    select: { email: true }
                });

                const keyholderNames = abandonedKeyholders.map(v => v.person.name || v.person.email).join(', ');

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

                logger.info(`CRITICAL NOTIFICATION TO BOARD MEMBERS (${boardMembers.map(m => m.email).join(', ')}):`);
                logger.info(`Facility was auto-closed by the nightly cron. The following keyholders failed to badge out: ${keyholderNames}`);
                
                boardNotified = true;
            }
        }

        // 2. Process all pending post-event emails immediately, regardless of 1-hour delay
        const emailResult = await processPostEventEmails({ forceImmediate: true });

        // 3. #1165: delete DoB for anyone who has crossed 26 since the last run. No
        // age-gated program can target anyone over 25 (MAX_PROGRAM_AGE), so a DoB for
        // a 26+ person is dead weight on our most-sensitive field. Strip it and set the
        // declared-adult flag so age gates / search / UI still see them as an adult.
        // The #1165 backfill migration did the one-time sweep; this keeps it clean as
        // members age in. Raw SQL so age is judged in the DB, tombstones included.
        const adultDobPurged = await prisma.$executeRaw`
            UPDATE "Person"
            SET "dateOfBirth" = NULL, "isDeclaredAdult" = true
            WHERE "dateOfBirth" IS NOT NULL
              AND "dateOfBirth" <= (CURRENT_DATE - INTERVAL '26 years')`;
        if (adultDobPurged > 0) {
            logger.info(`Nightly cron: purged DoB for ${adultDobPurged} member(s) now over 25 (#1165).`);
        }

        return NextResponse.json({
            success: true,
            facilityClose: {
                checkedOutCount,
                boardNotified
            },
            postEvents: emailResult,
            adultDobPurged
        });
});
