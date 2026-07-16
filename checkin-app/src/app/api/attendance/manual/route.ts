import { withAuth } from "@/lib/auth";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { findAssociatedEventAt, processVisitCheckout } from "@/lib/attendanceTransitions";
import { sendCheckinNotifications } from "@/lib/notifications";
import { logBackendError, logger } from "@/lib/logger";
import { apiError } from "@/lib/api-response";

// Self-service manual visit entry. INTENTIONAL by design: a member records a
// visit for THEMSELVES only (participantId is forced to auth.user.id, never taken
// from the body) to backfill a forgotten badge-in — left the badge at home, forgot
// to scan, etc. Every entry is audit-logged (see below). A member CAN backdate a
// closed visit arbitrarily far; that is accepted on purpose (people remember a
// past visit days later). The only downside is self-reported hours in
// facility/trends, which the board reconciles against the audit trail — it is not
// a security or integrity boundary. Recurring-audit note: this is not an IDOR and
// not a fabrication vuln; do not re-flag the arbitrary backdate.
export const POST = withAuth({}, async (req, auth) => {
    if (auth.type !== 'session') return apiError("Unauthorized", 401);
    try {
        const userId = auth.user.id;
        const body = await req.json();
        const { arrivedAt, departedAt } = body;

        if (!arrivedAt) {
            return apiError("Arrival time is required", 400);
        }

        const arrivalTime = new Date(arrivedAt);
        const departureTime = departedAt ? new Date(departedAt) : null;

        if (isNaN(arrivalTime.getTime())) {
            return apiError("Invalid arrival time", 400);
        }

        // No future arrivals. Allow a 5-min skew (clock drift, the minute it takes
        // to fill the form) and clamp anything inside that window back to now, so a
        // slightly-future time records as-of-now instead of being rejected.
        const now = new Date();
        if (arrivalTime.getTime() > now.getTime() + 5 * 60 * 1000) {
            return apiError("Arrival time cannot be in the future.", 400);
        }
        if (arrivalTime.getTime() > now.getTime()) {
            arrivalTime.setTime(now.getTime());
        }
        if (departureTime && isNaN(departureTime.getTime())) {
            return apiError("Invalid departure time", 400);
        }

        if (departureTime && departureTime <= arrivalTime) {
            return apiError("Departure time must be after arrival time", 400);
        }

        // Blank departure means "still in the building" → an open visit. Only allow
        // that for a recent arrival: today (same calendar day) or within the last
        // 6 hours (covers arriving late last night and still being here). A stale
        // arrival with no departure would create a permanent open visit nobody
        // scanned out of, so require a departure for it.
        if (!departureTime) {
            const withinSixHours = now.getTime() - arrivalTime.getTime() <= 6 * 60 * 60 * 1000;
            const sameDay = arrivalTime.toDateString() === now.toDateString();
            if (!withinSixHours && !sameDay) {
                return apiError("Departure time is required for past arrivals.", 400);
            }
        }

        const eventId = await findAssociatedEventAt(userId, arrivalTime);

        // Creating an open visit (no departure) is a read-modify-write on this
        // participant's visit state, just like /api/scan. Take the same
        // per-participant advisory xact lock and re-check for an existing open
        // visit before creating, so two concurrent manual submits — or a manual
        // submit racing a kiosk scan — can't leave two open visits for one
        // participant (checkout closes only one, the other lingers forever).
        const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${Number(userId)})`;

            // Only an open visit carries dedup-able state; a closed one (departure
            // provided) is just a historical record, so multiple are fine.
            if (!departureTime) {
                const openVisit = await tx.visit.findFirst({
                    where: { personId: userId, departedAt: null }
                });
                if (openVisit) return { visit: openVisit, freshCheckin: false };

                // An open backfill claims the actor is in the building NOW, so the
                // same facility-open guard as /api/scan applies: a non-keyholder
                // cannot be the first (only) person present. A closed backfill is
                // historical and never gates. Checked under the lock so a racing
                // keyholder check-in is either committed-and-seen or not yet.
                if (!auth.user.isKeyholder) {
                    const activeKeyholders = await tx.visit.count({
                        where: { departedAt: null, person: { isKeyholder: true } }
                    });
                    if (activeKeyholders === 0) return { facilityClosed: true as const };
                }
            }

            const created = await tx.visit.create({
                data: {
                    personId: userId,
                    arrivedAt: arrivalTime,
                    departedAt: departureTime,
                    arrivedVia: "WEB",
                    departedVia: departureTime ? "WEB" : null,
                    associatedEventId: eventId
                }
            });
            // freshCheckin only when a NEW open visit was created — not a backfilled
            // closed visit (has departure) and not the dedup return above.
            return { visit: created, freshCheckin: !departureTime };
        }, {
            maxWait: 5000,
            timeout: 15000,
        });

        if ('facilityClosed' in result) {
            return apiError("Facility is closed. A Keyholder must check in first.", 403);
        }
        const { visit, freshCheckin } = result;

        // If a departure time was provided, we process the checkout logic directly
        // to handle any back-to-back event transitions.
        if (departureTime) {
             await processVisitCheckout(visit.id, departureTime, undefined, "WEB");
        }

        // Fire-and-forget: notify only on a fresh active check-in (mirrors /api/scan).
        // A backfilled closed visit is a historical record, not a live arrival.
        if (freshCheckin) {
            sendCheckinNotifications(Number(userId), 'checkin').catch(err =>
                logger.error('Checkin notification error:', err)
            );
        }

        await prisma.auditLog.create({
            data: {
                actorId: userId,
                action: "CREATE",
                tableName: "Visit",
                affectedEntityId: visit.id,
                newData: { arrivedAt, departedAt, type: "manual_entry" }
            }
        });

        return NextResponse.json({ message: "Manual visit recorded successfully.", visit }, { status: 201 });
    } catch (error: unknown) {
        await logBackendError(error, "POST /api/attendance/manual");
        return apiError("Internal Server Error", 500);
    }
});
