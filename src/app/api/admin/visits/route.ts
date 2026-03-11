/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser, requireAdmin } from "@/lib/auth";

export async function GET(req: NextRequest) {
    try {
        const user = await getCurrentUser();
        requireAdmin(user);

        // Fetch visits intentionally ordered by most recent first
        const visits = await prisma.visit.findMany({
            take: 50,
            orderBy: { arrived: "desc" },
            include: {
                participant: {
                    select: { email: true, sysadmin: true, keyholder: true },
                },
            },
        });

        return NextResponse.json({ visits });
    } catch (err: any) {
        if (err.message.includes("Unauthorized")) {
            return NextResponse.json({ error: err.message }, { status: 403 });
        }
        console.error("Fetch visits error:", err);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

export async function PATCH(req: NextRequest) {
    try {
        const user = await getCurrentUser();
        requireAdmin(user);

        const { visitId, arrived, departed } = await req.json();

        if (!visitId) {
            return NextResponse.json({ error: "visitId is required." }, { status: 400 });
        }

        const updatedVisit = await prisma.visit.update({
            where: { id: visitId },
            data: {
                ...(arrived ? { arrived: new Date(arrived) } : {}),
                ...(departed ? { departed: new Date(departed) } : {}),
            },
        });

        // Log the manual edit in the audit trails (Phase 8 requirement preview)
        await prisma.auditLog.create({
            data: {
                actorId: (user as any).id,
                action: "EDIT",
                tableName: "Visit",
                affectedEntityId: visitId,
                newData: JSON.parse(JSON.stringify(updatedVisit)),
            },
        });

        return NextResponse.json({ visit: updatedVisit });
    } catch (err: any) {
        if (err.message.includes("Unauthorized")) {
            return NextResponse.json({ error: err.message }, { status: 403 });
        }
        console.error("Update visit error:", err);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
