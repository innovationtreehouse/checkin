import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { parseVisitTime, departureAfterArrival } from "@/lib/visitTimes";

export const GET = withAuth(
    { roles: ['isSysadmin', 'isBoardMember'] },
    async () => {
        try {
            const visits = await prisma.visit.findMany({
                take: 50,
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
