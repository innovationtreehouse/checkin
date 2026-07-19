import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { parseVisitTime, departureAfterArrival, withinMaxDuration } from "@/lib/visitTimes";
import { handler } from "@/security/handler";

// Registry-governed (GET /api/facility/visits): admission anyRole
// sysadmin/board; envelope 'visits'. Nested person carries email (pii) —
// covered by the admin everyones band, and now stripped for any role a
// future view adds. Same query, same take-50 shape.
export const GET = handler('GET /api/facility/visits', async () => {
    const visits = await prisma.visit.findMany({
        take: 50,
        orderBy: { arrivedAt: "desc" },
        include: {
            person: {
                select: { email: true, name: true, isSysadmin: true, isKeyholder: true },
            },
        },
    });

    return { Visit: visits };
});

export const PATCH = withAuth(
    { roles: ['isSysadmin', 'isBoardMember'] },
    async (req, auth) => {
        try {
            const { visitId, arrivedAt, departedAt } = await req.json();

            if (!visitId) {
                return apiError("visitId is required.", 400);
            }

            const existing = await prisma.visit.findUnique({ where: { id: visitId } });
            if (!existing) {
                return apiError("Visit not found.", 404); // also turns a bad id into a clean 404
            }

            const now = new Date();
            let nextArrived = existing.arrivedAt;
            let nextDeparted = existing.departedAt;

            if (arrivedAt) {
                const r = parseVisitTime(arrivedAt, "arrival", now);
                if (!r.ok) return apiError(r.error, 400);
                nextArrived = r.value;
            }
            if (departedAt) {
                const r = parseVisitTime(departedAt, "departure", now);
                if (!r.ok) return apiError(r.error, 400);
                nextDeparted = r.value;
            }

            // Result must be closed: can close an open visit, never reopen a closed one.
            if (nextDeparted === null) {
                return apiError("Departure time is required to close this visit.", 400);
            }
            if (!departureAfterArrival(nextArrived, nextDeparted)) {
                return apiError("Departure time must be after arrival time", 400);
            }
            if (!withinMaxDuration(nextArrived, nextDeparted)) {
                return apiError("A visit cannot be longer than 24 hours.", 400);
            }

            const updatedVisit = await prisma.visit.update({
                where: { id: visitId },
                data: {
                    ...(arrivedAt ? { arrivedAt: nextArrived, arrivedVia: "WEB" } : {}),
                    ...(departedAt ? { departedAt: nextDeparted, departedVia: "WEB" } : {}),
                },
            });

            // Log the manual edit in the audit trail
            if (auth.type === 'session') {
                await prisma.auditLog.create({
                    data: {
                        actorId: auth.user.id,
                        action: "EDIT",
                        tableName: "Visit",
                        affectedEntityId: visitId,
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
            if (!existing) {
                return apiError("Visit not found.", 404);
            }

            await prisma.visit.delete({ where: { id: visitId } });

            // Log the manual deletion in the audit trail — keep the deleted row in oldData
            // since it no longer exists anywhere else.
            if (auth.type === 'session') {
                await prisma.auditLog.create({
                    data: {
                        actorId: auth.user.id,
                        action: "DELETE",
                        tableName: "Visit",
                        affectedEntityId: visitId,
                        oldData: JSON.parse(JSON.stringify(existing)),
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
