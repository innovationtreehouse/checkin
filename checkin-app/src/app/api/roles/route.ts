import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";

export const GET = withAuth(
    { roles: ['isSysadmin', 'isBoardMember'] },
    async () => {
        try {
            const eighteenYearsAgo = new Date();
            eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 18);

            const rows = await prisma.person.findMany({
                select: {
                    id: true,
                    email: true,
                    name: true,
                    dateOfBirth: true,
                    isSysadmin: true,
                    isBoardMember: true,
                    isKeyholder: true,
                    isBackgroundCheckReviewer: true,
                },
                orderBy: { name: "asc" },
            });
            // Don't leak dob (PII); expose only a youth flag for filtering.
            const participants = rows.map(({ dateOfBirth, ...p }: (typeof rows)[number]) => ({
                ...p,
                isYouth: dateOfBirth != null && dateOfBirth > eighteenYearsAgo,
            }));
            return NextResponse.json({ participants });
        } catch (error) {
            console.error("Error fetching roles:", error);
            return NextResponse.json({ error: "Internal server error" }, { status: 500 });
        }
    }
);

export const PATCH = withAuth(
    { roles: ['isSysadmin', 'isBoardMember'] },
    async (req, auth) => {
        try {
            const body = await req.json();
            const { targetUserId, ...roleUpdates } = body;

            if (!targetUserId) {
                return NextResponse.json({ error: "Missing 'targetUserId'" }, { status: 400 });
            }

            // Board Members cannot modify isSysadmin privileges
            if (auth.type === 'session' && !auth.user.isSysadmin && roleUpdates.isSysadmin !== undefined) {
                return NextResponse.json(
                    { error: "Only Sysadmins can modify isSysadmin privileges" },
                    { status: 403 }
                );
            }

            const allowedFields = ["isSysadmin", "isBoardMember", "isKeyholder", "isBackgroundCheckReviewer"];
            const updateData: Record<string, NonNullable<unknown> | null | string | number | boolean | Date> = {};
            for (const field of allowedFields) {
                if (roleUpdates[field] !== undefined) {
                    updateData[field] = Boolean(roleUpdates[field]);
                }
            }

            if (Object.keys(updateData).length === 0) {
                return NextResponse.json({ error: "No valid role fields provided" }, { status: 400 });
            }

            const updated = await prisma.person.update({
                where: { id: targetUserId },
                data: updateData,
                select: {
                    id: true,
                    email: true,
                    name: true,
                    isSysadmin: true,
                    isBoardMember: true,
                    isKeyholder: true,
                    isBackgroundCheckReviewer: true,
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
