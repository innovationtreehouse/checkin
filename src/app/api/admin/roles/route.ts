/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";

export const GET = withAuth(
    { roles: ['sysadmin', 'boardMember'] },
    async () => {
        try {
            const eighteenYearsAgo = new Date();
            eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 18);

            const participants = await prisma.participant.findMany({
                where: {
                    OR: [
                        { dob: { lte: eighteenYearsAgo } },
                        { dob: null }
                    ]
                },
                select: {
                    id: true,
                    email: true,
                    name: true,
                    sysadmin: true,
                    boardMember: true,
                    keyholder: true,
                    shopSteward: true,
                },
                orderBy: { name: "asc" },
            });
            return NextResponse.json({ participants });
        } catch (error) {
            console.error("Error fetching roles:", error);
            return NextResponse.json({ error: "Internal server error" }, { status: 500 });
        }
    }
);

export const POST = withAuth(
    { roles: ['sysadmin', 'boardMember'] },
    async (req, auth) => {
        try {
            const body = await req.json();
            const { targetUserId, ...roleUpdates } = body;

            if (!targetUserId) {
                return NextResponse.json({ error: "Missing 'targetUserId'" }, { status: 400 });
            }

            // Board Members cannot modify sysadmin privileges
            if (auth.type === 'session' && !auth.user.sysadmin && roleUpdates.sysadmin !== undefined) {
                return NextResponse.json(
                    { error: "Only Sysadmins can modify sysadmin privileges" },
                    { status: 403 }
                );
            }

            const allowedFields = ["sysadmin", "boardMember", "keyholder", "shopSteward"];
            const updateData: any = {};
            for (const field of allowedFields) {
                if (roleUpdates[field] !== undefined) {
                    updateData[field] = Boolean(roleUpdates[field]);
                }
            }

            if (Object.keys(updateData).length === 0) {
                return NextResponse.json({ error: "No valid role fields provided" }, { status: 400 });
            }

            const updated = await prisma.participant.update({
                where: { id: targetUserId },
                data: updateData,
                select: {
                    id: true,
                    email: true,
                    name: true,
                    sysadmin: true,
                    boardMember: true,
                    keyholder: true,
                    shopSteward: true,
                },
            });

            // Log the role change
            if (auth.type === 'session') {
                await prisma.auditLog.create({
                    data: {
                        actorId: auth.user.id,
                        action: "EDIT",
                        tableName: "Participant",
                        affectedEntityId: targetUserId,
                        newData: updateData,
                    },
                });
            }

            return NextResponse.json({ message: "Roles updated successfully", user: updated });
        } catch (error) {
            console.error("Error updating role:", error);
            return NextResponse.json({ error: "Internal server error" }, { status: 500 });
        }
    }
);
