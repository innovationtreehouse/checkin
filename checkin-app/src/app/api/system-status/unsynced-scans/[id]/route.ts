import prisma from "@/lib/prisma";
import { handler, badRequest, notFound, unauthorized, ApiResponseError } from "@/security/handler";
import { classifyPresenceEvent, PresenceClass } from "@/lib/presence/events";
import { LIVE_PERSON } from "@/lib/person/filters";
import { LIVE_VISIT } from "@/lib/visit/filters";

// Registry-governed (POST /api/system-status/unsynced-scans/[id]): admission
// anyRole sysadmin/board/keyholder (Q15; operations stay out — #1633);
// envelope null. `[id]` is a RawBadgeLog id.
//
// Two actions, both stamping the review columns exactly once:
//
// Dismiss (default) — "I looked, nothing to do." Touches nothing else;
// reviewReason is left intact so the row keeps saying why it parked.
//
// Record (§5.26/B4, ruled 2026-08-28) — writes the Visit the parked scan
// described, at the row's OWN timestamp, never at resolution time. The
// manual tool's 6h/same-day staleness bound deliberately does NOT apply: it
// guards a human's memory, and this row is machine-stamped at the door. An
// IN with no matching OUT is the caller's choice (Q13 human-always): leave
// the visit open — allowed only while the facility is live-open, since an
// open visit joins today's supervision math — or close it at a departure
// the reviewer supplies.
//
// The updateMany where clause carries the concurrency guard: only a row that
// is actually PARKED and NOT yet reviewed can be stamped, so a double-click
// (either action) 404s rather than re-stamping — or double-minting — over
// the first reviewer.
export const POST = handler<{ id: string }>(
    'POST /api/system-status/unsynced-scans/[id]',
    async ({ req, auth, params }) => {
        if (auth.type !== 'session') throw unauthorized();

        const id = Number(params.id);
        if (!Number.isInteger(id)) throw badRequest("Invalid scan id");

        let body: { action?: unknown; departedAt?: unknown } = {};
        try {
            body = await req.json();
        } catch {
            // No body at all is a plain dismiss.
        }
        const action = body.action ?? 'dismiss';
        if (action !== 'dismiss' && action !== 'record') {
            throw badRequest("action must be 'dismiss' or 'record'.");
        }

        if (action === 'dismiss') {
            const { count } = await prisma.rawBadgeLog.updateMany({
                where: { id, reviewReason: { not: null }, reviewedAt: null },
                data: { reviewedAt: new Date(), reviewedBy: auth.user.id },
            });
            if (count === 0) throw notFound("No scan awaiting review with that id.");
            return {};
        }

        const parsedDeparted = typeof body.departedAt === 'string' ? new Date(body.departedAt) : null;
        if (body.departedAt !== undefined && (!parsedDeparted || isNaN(parsedDeparted.getTime()))) {
            throw badRequest("departedAt must be an ISO date string.");
        }

        const row = await prisma.rawBadgeLog.findFirst({
            where: { id, reviewReason: { not: null }, reviewedAt: null },
        });
        if (!row) throw notFound("No scan awaiting review with that id.");
        if (parsedDeparted && parsedDeparted <= row.timestamp) {
            throw badRequest("departedAt must be after the scan time.");
        }

        // A merge racing the review leaves a tombstone; one hop reaches the
        // keeper (the archive design guarantees chains never exceed it).
        const scanned = await prisma.person.findUnique({ where: { id: row.personId } });
        if (!scanned) throw notFound("No scan awaiting review with that id.");
        const person = scanned.mergedIntoId
            ? ((await prisma.person.findFirst({ where: { id: scanned.mergedIntoId, ...LIVE_PERSON } })) ?? scanned)
            : scanned;

        await prisma.$transaction(async (tx) => {
            // A visit already covering scannedAt means this scan is accounted
            // for — minting another would double-count the person.
            const overlapping = await tx.visit.findFirst({
                where: {
                    personId: person.id,
                    arrivedAt: { lte: row.timestamp },
                    OR: [{ departedAt: null }, { departedAt: { gte: row.timestamp } }],
                    ...LIVE_VISIT,
                },
                select: { id: true },
            });
            if (overlapping) {
                throw new ApiResponseError(409, "A visit already covers that scan time — dismiss the row instead.");
            }

            // Leaving the visit open puts this person in TODAY's live roster,
            // so the live rule applies: a non-keyholder cannot be the only one
            // in the building (#254 keyholder-first).
            if (!parsedDeparted && !person.isKeyholder) {
                const activeKeyholders = await tx.visit.count({
                    where: { departedAt: null, person: { isKeyholder: true, ...LIVE_PERSON }, ...LIVE_VISIT },
                });
                if (activeKeyholders === 0) {
                    throw new ApiResponseError(403, "Facility is closed — supply a departure time to record this visit as closed.");
                }
            }

            const visit = await tx.visit.create({
                data: {
                    personId: person.id,
                    arrivedAt: row.timestamp,
                    departedAt: parsedDeparted,
                    arrivedVia: "SCANNER",
                },
            });

            const { count } = await tx.rawBadgeLog.updateMany({
                where: { id, reviewReason: { not: null }, reviewedAt: null },
                data: { reviewedAt: new Date(), reviewedBy: auth.user.id },
            });
            if (count === 0) throw notFound("No scan awaiting review with that id.");

            // Close the loop in the presence log: the parked event this row
            // mirrors (they share clientEventId) is now projected into a real
            // Visit. Rows with no event (legacy, web) simply have none to move.
            if (row.clientEventId) {
                const ev = await tx.presenceEvent.findUnique({ where: { clientEventId: row.clientEventId } });
                if (ev && ev.classification?.startsWith("PARKED")) {
                    await classifyPresenceEvent(tx, ev.id, PresenceClass.PROJECTED, visit.id);
                }
            }
        });

        // Empty bag — the panel drops the row client-side; the registry
        // declares `envelope: null` and the 200 body is `{}`.
        return {};
    },
);
