/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any */
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session || !session.user || !(session.user as any).id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const userId = (session.user as any).id;
        const currentUser = await prisma.participant.findUnique({ where: { id: userId } });

        if (!currentUser?.sysadmin && !currentUser?.boardMember) {
            return NextResponse.json({ error: "Forbidden: Requires Sysadmin or Board Member privileges" }, { status: 403 });
        }

        // Filter out students (under 18)
        const eighteenYearsAgo = new Date();
        eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 18);

        // Fetch all adult users with their roles, ordered by name
        const participants = await prisma.participant.findMany({
            where: {
                OR: [
                    { dob: { lte: eighteenYearsAgo } },
                    { dob: null, email: { not: null } } // fallback: adults likely have emails, students shouldn't
                ]
            },
            select: {
                id: true,
                name: true,
                email: true,
                sysadmin: true,
                boardMember: true,
                keyholder: true,
                shopSteward: true,
            },
            orderBy: {
                name: 'asc'
            }
        });

        return NextResponse.json({ participants }, { status: 200 });

    } catch (error: any) {
        console.error("Admin Roles GET Error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

export async function PATCH(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session || !session.user || !(session.user as any).id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const userId = (session.user as any).id;
        const currentUser = await prisma.participant.findUnique({ where: { id: userId } });

        if (!currentUser?.sysadmin && !currentUser?.boardMember) {
            return NextResponse.json({ error: "Forbidden: Requires Sysadmin or Board Member privileges" }, { status: 403 });
        }

        const body = await req.json();
        const { targetUserId, sysadmin, boardMember, keyholder, shopSteward } = body;

        if (!targetUserId) {
            return NextResponse.json({ error: "targetUserId is required" }, { status: 400 });
        }

        // Only sysadmins can grant or revoke sysadmin privileges
        if (!currentUser.sysadmin && sysadmin !== undefined) {
            const targetCurrentState = await prisma.participant.findUnique({ where: { id: targetUserId } });
            if (targetCurrentState?.sysadmin !== sysadmin) {
                return NextResponse.json({ error: "Only Sysadmins can modify sysadmin privileges" }, { status: 403 });
            }
        }

        const updatedUser = await prisma.participant.update({
            where: { id: targetUserId },
            data: {
                sysadmin: sysadmin !== undefined ? sysadmin : undefined,
                boardMember: boardMember !== undefined ? boardMember : undefined,
                keyholder: keyholder !== undefined ? keyholder : undefined,
                shopSteward: shopSteward !== undefined ? shopSteward : undefined,
            }
        });

        await prisma.auditLog.create({
            data: {
                actorId: userId,
                action: "EDIT",
                tableName: "Participant.Roles",
                affectedEntityId: targetUserId,
                newData: JSON.stringify({ sysadmin, boardMember, keyholder, shopSteward })
            }
        });

        return NextResponse.json({ message: "Roles updated successfully", user: updatedUser }, { status: 200 });

    } catch (error: any) {
        console.error("Admin Roles PATCH Error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
