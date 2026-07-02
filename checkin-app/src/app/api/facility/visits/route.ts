import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";

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
            console.error("Fetch visits error:", error);
            return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
        }
    }
);

export const PATCH = withAuth(
    { roles: ['isSysadmin', 'isBoardMember'] },
    async (req, auth) => {
        try {
            const { visitId, arrivedAt, departedAt } = await req.json();

            if (!visitId) {
                return NextResponse.json({ error: "visitId is required." }, { status: 400 });
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
            console.error("Update visit error:", error);
            return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
        }
    }
);
