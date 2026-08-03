import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import type { Prisma, Visit } from "@/generated/prisma/client";
import { withAuth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { parseVisitTime, departureAfterArrival, withinMaxDuration } from "@/lib/visitTimes";
import { findAssociatedEventAt } from "@/lib/attendanceTransitions";
import { LIVE_PERSON } from "@/lib/person/filters";

export const GET = withAuth(
    { roles: ['isSysadmin', 'isBoardMember'] },
    async () => {
        try {
            const visits = await prisma.visit.findMany({
                take: 50,
                where: { deletedAt: null },
                orderBy: { arrivedAt: "desc" },
                include: {
                    person: {
                        select: { email: true, name: true, isSysadmin: true, isKeyholder: true },
                    },
                },
            });

            return NextResponse.json({ visits });
        } catch (error) {
            logger.error("Fetch visits error:", error);
            return apiError("Internal Server Error", 500);
        }
    }
);

// Staff insert-for-others at an arbitrary past time (design §3): the path for a
// genuine unenrolled walk-in, which the event-roster mark (program-scoped, event
// window) and the kiosk (live, badge-driven) cannot record. Unlike the
// self-service route the target personId IS taken from the body — that is the
// point of the endpoint — so the role gate is the whole boundary.
export const POST = withAuth(
    { roles: ['isSysadmin', 'isBoardMember'] },
    async (req, auth) => {
        try {
            const { personId, arrivedAt, departedAt } = await req.json();

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
                        arrivedVia: "WEB",
                        departedVia: "WEB",
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

export const PATCH = withAuth(
    { roles: ['isSysadmin', 'isBoardMember'] },
    async (req, auth) => {
        try {
            const { visitId, arrivedAt, departedAt } = await req.json();

            if (!visitId) {
                return apiError("visitId is required.", 400);
            }

            const existing = await prisma.visit.findUnique({ where: { id: visitId } });
            if (!existing || existing.deletedAt) {
                return apiError("Visit not found.", 404); // also turns a bad id into a clean 404
            }

            const now = new Date();
            let parsedArrived: Date | null = null;
            let parsedDeparted: Date | null = null;

            if (arrivedAt) {
                const r = parseVisitTime(arrivedAt, "arrival", now);
                if (!r.ok) return apiError(r.error, 400);
                parsedArrived = r.value;
            }
            if (departedAt) {
                const r = parseVisitTime(departedAt, "departure", now);
                if (!r.ok) return apiError(r.error, 400);
                parsedDeparted = r.value;
            }

            // Editing a visit is a read-modify-write on this person's visit state, so
            // it takes the same per-person advisory xact lock as /api/scan and re-reads
            // the row inside it — the pre-check above ran unserialized and a racing
            // scan or the facility-close sweep may have closed or removed the visit.
            const result = await prisma.$transaction(async (tx): Promise<{ error: string; status: number } | { visit: Visit }> => {
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(${existing.personId})`;

                const current = await tx.visit.findUnique({ where: { id: visitId } });
                if (!current || current.deletedAt) return { error: "Visit not found.", status: 404 as const };

                const nextArrived = parsedArrived ?? current.arrivedAt;
                const nextDeparted = parsedDeparted ?? current.departedAt;

                // Result must be closed: can close an open visit, never reopen a closed one.
                if (nextDeparted === null) {
                    return { error: "Departure time is required to close this visit.", status: 400 as const };
                }
                if (!departureAfterArrival(nextArrived, nextDeparted)) {
                    return { error: "Departure time must be after arrival time", status: 400 as const };
                }
                if (!withinMaxDuration(nextArrived, nextDeparted)) {
                    return { error: "A visit cannot be longer than 24 hours.", status: 400 as const };
                }

                return {
                    visit: await tx.visit.update({
                        where: { id: visitId },
                        data: {
                            ...(parsedArrived ? { arrivedAt: nextArrived, arrivedVia: "WEB" } : {}),
                            ...(parsedDeparted ? { departedAt: nextDeparted, departedVia: "WEB" } : {}),
                        },
                    })
                };
            }, { maxWait: 5000, timeout: 15000 });

            if ('error' in result) return apiError(result.error, result.status);
            const updatedVisit = result.visit;

            // Log the manual edit in the audit trail. secondaryAffectedEntity =
            // the visit's person, so a correction review can tell self from
            // acting-for-another by comparison alone (design §6.6).
            if (auth.type === 'session') {
                await prisma.auditLog.create({
                    data: {
                        actorId: auth.user.id,
                        action: "EDIT",
                        tableName: "Visit",
                        affectedEntityId: visitId,
                        secondaryAffectedEntity: existing.personId,
                        oldData: JSON.parse(JSON.stringify(existing)),
                        newData: JSON.parse(JSON.stringify(updatedVisit)),
                    },
                });
            }

            return NextResponse.json({ visit: updatedVisit });
        } catch (error) {
            logger.error("Update visit error:", error);
            return apiError("Internal Server Error", 500);
        }
    }
);

export const DELETE = withAuth(
    { roles: ['isSysadmin', 'isBoardMember'] },
    async (req, auth) => {
        try {
            const { visitId } = await req.json();

            if (!visitId) {
                return apiError("visitId is required.", 400);
            }

            const existing = await prisma.visit.findUnique({ where: { id: visitId } });
            if (!existing || existing.deletedAt) {
                return apiError("Visit not found.", 404);
            }

            // Same per-person advisory xact lock as the PATCH above, with the
            // existence check re-run inside it so a racing delete can't tombstone
            // the row twice and overwrite who deleted it.
            const removed = await prisma.$transaction(async (tx) => {
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(${existing.personId})`;

                const current = await tx.visit.findUnique({ where: { id: visitId } });
                if (!current || current.deletedAt) return null;

                // Tombstone, matching the member's own self-delete: a deleted visit
                // keeps its row so the deletion stays reviewable and reversible.
                await tx.visit.update({
                    where: { id: visitId },
                    data: { deletedAt: new Date(), deletedById: auth.type === 'session' ? auth.user.id : null },
                });
                return current;
            }, { maxWait: 5000, timeout: 15000 });

            if (!removed) return apiError("Visit not found.", 404);

            // Log the manual deletion in the audit trail — oldData carries the
            // pre-delete row so the review needs no join.
            if (auth.type === 'session') {
                await prisma.auditLog.create({
                    data: {
                        actorId: auth.user.id,
                        action: "DELETE",
                        tableName: "Visit",
                        affectedEntityId: visitId,
                        secondaryAffectedEntity: removed.personId,
                        oldData: JSON.parse(JSON.stringify(removed)),
                    },
                });
            }

            return NextResponse.json({ success: true });
        } catch (error) {
            logger.error("Delete visit error:", error);
            return apiError("Internal Server Error", 500);
        }
    }
);
