import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { withAuth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { parseVisitTime, departureAfterArrival, withinMaxDuration } from "@/lib/visitTimes";
import { findAssociatedEventAt } from "@/lib/attendanceTransitions";
import { LIVE_PERSON } from "@/lib/person/filters";

// Staff insert-for-others at an arbitrary past time (design §3): the path for a
// genuine unenrolled walk-in, which the event-roster mark (program-scoped, event
// window) and the kiosk (live, badge-driven) cannot record. Unlike the
// self-service route the target personId IS taken from the body — that is the
// point of the endpoint — so the role gate is the whole boundary. Declared in
// the security registry (POST /api/facility/visits/insert); it sits on its own
// path rather than as a POST on the sibling /api/facility/visits for the
// lint-ordering reason recorded there and in #1491.
export const POST = withAuth(
    { roles: ['isSysadmin', 'isBoardMember'] },
    async (req, auth) => {
        try {
            // A missing or malformed body is a client mistake, not a server
            // fault: 400 it rather than letting req.json() throw into the 500
            // path (which also logs, turning a bad request into error noise).
            const body = await req.json().catch(() => null);
            if (!body || typeof body !== "object") return apiError("Invalid JSON", 400);
            const { personId, arrivedAt, departedAt } = body;

            if (!personId) return apiError("personId is required.", 400);
            if (!arrivedAt) return apiError("Arrival time is required", 400);
            // Closed visits only. An open one would put someone on the live
            // in-the-building roster on staff say-so, and leave an open visit
            // nobody will badge out of; the kiosk owns live presence.
            if (!departedAt) return apiError("Departure time is required.", 400);

            const now = new Date();
            const ar = parseVisitTime(arrivedAt, "arrival", now);
            if (!ar.ok) return apiError(ar.error, 400);
            const dr = parseVisitTime(departedAt, "departure", now);
            if (!dr.ok) return apiError(dr.error, 400);
            if (!departureAfterArrival(ar.value, dr.value)) {
                return apiError("Departure time must be after arrival time", 400);
            }
            if (!withinMaxDuration(ar.value, dr.value)) {
                return apiError("A visit cannot be longer than 24 hours.", 400);
            }

            const subjectId = Number(personId);
            const person = await prisma.person.findFirst({
                where: { id: subjectId, ...LIVE_PERSON },
                select: { id: true },
            });
            if (!person) return apiError("Person not found.", 404);

            const eventId = await findAssociatedEventAt(subjectId, ar.value);

            // Same per-person advisory lock as every other visit write, so this
            // insert can't race the kiosk or the facility-close sweep.
            const visit = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(${subjectId})`;
                return tx.visit.create({
                    data: {
                        personId: subjectId,
                        arrivedAt: ar.value,
                        departedAt: dr.value,
                        // Staff-asserted, not measured — LEAD_MARKED, matching the
                        // events-roster mark and the #1632 backfill of prior rows
                        // that were wrongly stamped WEB. Excluded from
                        // facility/trends (see that route's filter).
                        arrivedVia: "LEAD_MARKED",
                        departedVia: "LEAD_MARKED",
                        associatedEventId: eventId,
                    },
                });
            });

            if (auth.type === 'session') {
                await prisma.auditLog.create({
                    data: {
                        actorId: auth.user.id,
                        action: "CREATE",
                        tableName: "Visit",
                        affectedEntityId: visit.id,
                        secondaryAffectedEntity: subjectId,
                        newData: { arrivedAt: ar.value, departedAt: dr.value, type: "staff_entry" },
                    },
                });
            }

            return NextResponse.json({ visit }, { status: 201 });
        } catch (error) {
            logger.error("Create visit error:", error);
            return apiError("Internal Server Error", 500);
        }
    }
);
