import prisma from "@/lib/prisma";
import { findAssociatedEventAt, processVisitCheckout } from "@/lib/attendanceTransitions";
import { sendCheckinNotifications } from "@/lib/notifications";
import { ApiResponseError, badRequest, forbidden } from "@/security/handler";
import type { Participant } from "@prisma/client";

/**
 * Process a check-in for a participant who has no active visit.
 *
 * Returns the response bag. Throws ApiResponseError to surface 4xx
 * conditions (handler() maps these to the right HTTP status).
 */
export async function processCheckin(participant: Participant, authType: string): Promise<Record<string, unknown>> {
    // Non-keyholders require an open facility (at least 1 keyholder present)
    if (!participant.keyholder) {
        const activeKeyholders = await prisma.visit.count({
            where: {
                departed: null,
                participant: { keyholder: true }
            }
        });

        if (activeKeyholders === 0) {
            throw forbidden("Facility is closed. A Keyholder must check in first.");
        }
    }

    const arrivalTime = new Date();
    const eventId = await findAssociatedEventAt(participant.id, arrivalTime);

    const newVisit = await prisma.visit.create({
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

    return {
        message: "Checked in successfully",
        type: "checkin" as const,
        participant,
        visit: newVisit,
        signedRequest: authType === "kiosk",
    };
}

/**
 * Process a check-out for a participant who has an active visit.
 * Handles last-keyholder logic and facility closure.
 *
 * Returns the response bag. Throws ApiResponseError to surface 4xx
 * conditions (handler() maps these to the right HTTP status). The
 * last-keyholder warning is a 400 with the warning text in `error`
 * plus `type: "warning"` in the body — preserved here via
 * `badRequest(msg, { type: "warning" })` so the framework emits
 * `{ error, details: { type: "warning" } }`.
 */
export async function processCheckout(
    participant: Participant,
    activeVisitId: number,
    authType: string
): Promise<Record<string, unknown>> {
    let facilityClosed = false;

    if (participant.keyholder) {
        const remainingKeyholders = await prisma.visit.count({
            where: {
                departed: null,
                participant: { keyholder: true },
                id: { not: activeVisitId }
            }
        });

        if (remainingKeyholders === 0) {
            const remainingUsers = await prisma.visit.findMany({
                where: {
                    departed: null,
                    id: { not: activeVisitId }
                },
                include: { participant: true }
            });

            if (remainingUsers.length > 0) {
                let confirmForceClose = false;

                const recentEvents = await prisma.rawBadgeEvent.findMany({
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
                    throw badRequest(
                        `Warning! You are the last keyholder, but others are here:\n${names}\n\nBadge again within 10 seconds to confirm you've checked them and close the facility.`,
                        { type: "warning" },
                    );
                }
            }

            facilityClosed = true;
            await prisma.visit.updateMany({
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

    const finalVisits = await processVisitCheckout(activeVisitId, new Date());
    const updatedVisit = finalVisits.length > 0 ? finalVisits[finalVisits.length - 1] : null;

    return {
        message: facilityClosed ? "Checked out and Facility closed" : "Checked out successfully",
        type: "checkout" as const,
        participant,
        visit: updatedVisit,
        facilityClosed,
        signedRequest: authType === "kiosk",
    };
}

// Re-export so callers don't have to import from both modules.
export { ApiResponseError };
