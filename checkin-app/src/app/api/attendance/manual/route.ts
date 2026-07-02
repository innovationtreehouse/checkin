import { withAuth } from "@/lib/auth";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { findAssociatedEventAt, processVisitCheckout } from "@/lib/attendanceTransitions";
import { logBackendError } from "@/lib/logger";

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
    if (auth.type !== 'session') return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const userId = auth.user.id;
        const body = await req.json();
        const { arrivedAt, departedAt } = body;

        if (!arrivedAt) {
            return NextResponse.json({ error: "Arrival time is required" }, { status: 400 });
        }

        const arrivalTime = new Date(arrivedAt);
        const departureTime = departedAt ? new Date(departedAt) : null;

        if (isNaN(arrivalTime.getTime())) {
            return NextResponse.json({ error: "Invalid arrival time" }, { status: 400 });
        }
        if (departureTime && isNaN(departureTime.getTime())) {
            return NextResponse.json({ error: "Invalid departure time" }, { status: 400 });
        }

        if (departureTime && departureTime <= arrivalTime) {
            return NextResponse.json({ error: "Departure time must be after arrival time" }, { status: 400 });
        }

        // Blank departure means "still in the building" → an open visit. Only allow
        // that for a recent arrival: today (same calendar day) or within the last
        // 6 hours (covers arriving late last night and still being here). A stale
        // arrival with no departure would create a permanent open visit nobody
        // scanned out of, so require a departure for it.
        if (!departureTime) {
            const now = new Date();
            const withinSixHours = now.getTime() - arrivalTime.getTime() <= 6 * 60 * 60 * 1000;
            const sameDay = arrivalTime.toDateString() === now.toDateString();
            if (!withinSixHours && !sameDay) {
                return NextResponse.json({ error: "Departure time is required for past arrivals." }, { status: 400 });
            }
        }

        const eventId = await findAssociatedEventAt(userId, arrivalTime);

        // Creating an open visit (no departure) is a read-modify-write on this
        // participant's visit state, just like /api/scan. Take the same
        // per-participant advisory xact lock and re-check for an existing open
        // visit before creating, so two concurrent manual submits — or a manual
        // submit racing a kiosk scan — can't leave two open visits for one
        // participant (checkout closes only one, the other lingers forever).
        const visit = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${Number(userId)})`;

            // Only an open visit carries dedup-able state; a closed one (departure
            // provided) is just a historical record, so multiple are fine.
            if (!departureTime) {
                const openVisit = await tx.visit.findFirst({
                    where: { personId: userId, departedAt: null }
                });
                if (openVisit) return openVisit;
            }

            return await tx.visit.create({
                data: {
                    personId: userId,
                    arrivedAt: arrivalTime,
                    departedAt: departureTime,
                    arrivedVia: "WEB",
                    departedVia: departureTime ? "WEB" : null,
                    associatedEventId: eventId
                }
            });
        }, {
            maxWait: 5000,
            timeout: 15000,
        });

        // If a departure time was provided, we process the checkout logic directly 
        // to handle any back-to-back event transitions.
        if (departureTime) {
             await processVisitCheckout(visit.id, departureTime, undefined, "WEB");
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
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
});
