import prisma from "@/lib/prisma";
import { findAssociatedEventAt, processVisitCheckout } from "@/lib/attendanceTransitions";
import { sendCheckinNotifications } from "@/lib/notifications";
import { apiError, apiJson } from "@/lib/api-response";
import type { Person } from "@/generated/prisma/client";
import { type DbClient, isRootClient } from "@/lib/db-client";

/**
 * Process a check-in for a participant who has no active visit.
 *
 * The scan route passes its transaction client `db` so these reads and writes
 * run under the per-participant advisory lock. When called standalone (e.g.
 * unit tests) `db` defaults to the global prisma client. Fire-and-forget side
 * effects (notifications) intentionally run off the global client either way.
 */
export async function processCheckin(participant: Person, authType: string, db: DbClient = prisma) {
    // Non-keyholders require an open facility (at least 1 isKeyholder present)
    if (!participant.isKeyholder) {
        const activeKeyholders = await db.visit.count({
            where: {
                departedAt: null,
                person: { isKeyholder: true }
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
            personId: participant.id,
            arrivedAt: arrivalTime,
            arrivedVia: "SCANNER",
            associatedEventId: eventId
        },
    });

    // Fire-and-forget: send check-in notifications
    sendCheckinNotifications(participant.id, 'checkin', 'SCANNER').catch(err =>
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
 * Handles last-isKeyholder logic and facility closure.
 *
 * `db` is the scan route's transaction client (covered by the per-participant
 * advisory lock) or, when called standalone, the global prisma client.
 */
export async function processCheckout(
    participant: Person,
    activeVisitId: number,
    authType: string,
    db: DbClient = prisma
) {
    let facilityClosed = false;

    if (participant.isKeyholder) {
        const remainingKeyholders = await db.visit.count({
            where: {
                departedAt: null,
                person: { isKeyholder: true },
                id: { not: activeVisitId }
            }
        });

        if (remainingKeyholders === 0) {
            const remainingUsers = await db.visit.findMany({
                where: {
                    departedAt: null,
                    id: { not: activeVisitId }
                },
                include: { person: true }
            });

            if (remainingUsers.length > 0) {
                let confirmForceClose = false;

                const recentEvents = await db.rawBadgeLog.findMany({
                    where: { personId: participant.id },
                    orderBy: { timestamp: "desc" },
                    take: 2
                });

                if (recentEvents.length === 2) {
                    const timeDiff = recentEvents[0].timestamp.getTime() - recentEvents[1].timestamp.getTime();
                    if (timeDiff <= 12000) {
                        confirmForceClose = true;
                    }
                }

                if (!confirmForceClose) {
                    const names = remainingUsers.map(u => u.person.name || u.person.email).join(", ");
                    return apiJson({
                        error: `Warning! You are the last isKeyholder, but others are here:\n${names}\n\nBadge again within 10 seconds to confirm you've checked them and close the facility.`,
                        type: "warning" as const
                    }, 400);
                }
            }

            facilityClosed = true;

            // The facility-wide sweep takes row locks on EVERY open visit, and
            // the email kick fires its own DB queries. Neither may run inside the
            // scan route's per-participant advisory-lock transaction: it would
            // block concurrent scans for other participants and let the email run
            // contend on the still-open transaction. When called standalone (root
            // client — e.g. tests) we own the whole operation, so run them here;
            // under the route's tx client the route runs both AFTER it commits
            // (see finalizeFacilityClose / route.ts).
            if (isRootClient(db)) {
                await closeAllOpenVisits(db);
                kickPostEventEmails();
            }
        }
    }

    const finalVisits = await processVisitCheckout(activeVisitId, new Date(), db, "SCANNER");
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

/** Mark every still-open visit as departed. Facility-wide, not participant-scoped:
 *  a single atomic statement, so it needs no wrapping transaction. */
async function closeAllOpenVisits(db: DbClient) {
    await db.visit.updateMany({
        where: { departedAt: null },
        data: { departedAt: new Date(), departedVia: "SYSTEM" },
    });
}

/** Fire-and-forget post-event email run on facility close. The dynamic import
 *  AND the call are both in the promise chain, so an import or run failure is
 *  logged, never an unhandled rejection. */
function kickPostEventEmails() {
    import("@/lib/postEventEmails")
        .then(({ processPostEventEmails }) => processPostEventEmails({ forceImmediate: true }))
        .catch(err => console.error("Failed to run post-event emails on facility close:", err));
}

/**
 * Run the facility-wide visit close + post-event email kick AFTER the scan
 * route's per-participant transaction has committed — off the advisory lock.
 *
 * processCheckout (under the lock, on the tx client) only *decides* whether the
 * facility closed and reports it via `facilityClosed` in the response body; the
 * route hands that response here once committed. A sweep failure is logged, not
 * thrown, so it never turns an already-committed checkout into a 500.
 */
export async function finalizeFacilityClose(res: Response): Promise<void> {
    let body: { facilityClosed?: boolean } | null;
    try {
        body = await res.clone().json();
    } catch {
        return; // non-JSON / empty body (e.g. debounce) — nothing to close
    }
    if (!body?.facilityClosed) return;

    try {
        await closeAllOpenVisits(prisma);
    } catch (err) {
        console.error("Failed to close facility-wide visits after scan:", err);
    }
    kickPostEventEmails();
}
