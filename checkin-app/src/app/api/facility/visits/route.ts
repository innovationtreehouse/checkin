import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";

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

            const updatedVisit = await prisma.visit.update({
                where: { id: visitId },
                data: {
                    ...(arrivedAt ? { arrivedAt: new Date(arrivedAt), arrivedVia: "WEB" } : {}),
                    ...(departedAt ? { departedAt: new Date(departedAt), departedVia: "WEB" } : {}),
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
