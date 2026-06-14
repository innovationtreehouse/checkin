import prisma from "@/lib/prisma";
import { findAssociatedEventAt, processVisitCheckout } from "@/lib/attendanceTransitions";
import { sendCheckinNotifications } from "@/lib/notifications";
import { apiError, apiJson } from "@/lib/api-response";
import type { Participant, PrismaClient, Prisma } from "@/generated/prisma/client";

/** Global client or a caller-supplied transaction-scoped client. */
type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * Process a check-in for a participant who has no active visit.
 *
 * The scan route passes its transaction client `db` so these reads and writes
 * run under the per-participant advisory lock. When called standalone (e.g.
 * unit tests) `db` defaults to the global prisma client. Fire-and-forget side
 * effects (notifications) intentionally run off the global client either way.
 */
export async function processCheckin(participant: Participant, authType: string, db: DbClient = prisma) {
    // Non-keyholders require an open facility (at least 1 keyholder present)
    if (!participant.keyholder) {
        const activeKeyholders = await db.visit.count({
            where: {
                departed: null,
                participant: { keyholder: true }
            }
        });

        if (activeKeyholders === 0) {
            return apiError("Facility is closed. A Keyholder must check in first.", 403);
        }
    }

    const arrivalTime = new Date();
    const eventId = await findAssociatedEventAt(participant.id, arrivalTime, db);

    const newVisit = await db.visit.create({
        data: {
            participantId: participant.id,
            arrived: arrivalTime,
            associatedEventId: eventId
        },
    });

    // Fire-and-forget: send check-in notifications
    sendCheckinNotifications(participant.id, 'checkin').catch(err =>
        console.error('Checkin notification error:', err)
    );

    return apiJson({
        message: "Checked in successfully",
        type: "checkin" as const,
        participant,
        visit: newVisit,
        signedRequest: authType === "kiosk",
    });
}

/**
 * Process a check-out for a participant who has an active visit.
 * Handles last-keyholder logic and facility closure.
 *
 * `db` is the scan route's transaction client (covered by the per-participant
 * advisory lock) or, when called standalone, the global prisma client.
 */
export async function processCheckout(
    participant: Participant,
    activeVisitId: number,
    authType: string,
    db: DbClient = prisma
) {
    let facilityClosed = false;

    if (participant.keyholder) {
        const remainingKeyholders = await db.visit.count({
            where: {
                departed: null,
                participant: { keyholder: true },
                id: { not: activeVisitId }
            }
        });

        if (remainingKeyholders === 0) {
            const remainingUsers = await db.visit.findMany({
                where: {
                    departed: null,
                    id: { not: activeVisitId }
                },
                include: { participant: true }
            });

            if (remainingUsers.length > 0) {
                let confirmForceClose = false;

                const recentEvents = await db.rawBadgeEvent.findMany({
                    where: { participantId: participant.id },
                    orderBy: { time: "desc" },
                    take: 2
                });

                if (recentEvents.length === 2) {
                    const timeDiff = recentEvents[0].time.getTime() - recentEvents[1].time.getTime();
                    if (timeDiff <= 12000) {
                        confirmForceClose = true;
                    }
                }

                if (!confirmForceClose) {
                    const names = remainingUsers.map(u => u.participant.name || u.participant.email).join(", ");
                    return apiJson({
                        error: `Warning! You are the last keyholder, but others are here:\n${names}\n\nBadge again within 10 seconds to confirm you've checked them and close the facility.`,
                        type: "warning" as const
                    }, 400);
                }
            }

            facilityClosed = true;
            await db.visit.updateMany({
                where: { departed: null },
                data: { departed: new Date() }
            });

            // Trigger post-event emails on facility close
            import("@/lib/postEventEmails").then(({ processPostEventEmails }) => {
                processPostEventEmails({ forceImmediate: true }).catch(err => {
                    console.error("Failed to run post-event emails on facility close:", err);
                });
            });
        }
    }

    const finalVisits = await processVisitCheckout(activeVisitId, new Date(), db);
    const updatedVisit = finalVisits.length > 0 ? finalVisits[finalVisits.length - 1] : null;

    return apiJson({
        message: facilityClosed ? "Checked out and Facility closed" : "Checked out successfully",
        type: "checkout" as const,
        participant,
        visit: updatedVisit,
        facilityClosed,
        signedRequest: authType === "kiosk",
    });
}
