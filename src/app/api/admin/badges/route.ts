/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser, requireAdmin } from "@/lib/auth";

export async function GET(req: NextRequest) {
    try {
        const user = await getCurrentUser();
        requireAdmin(user);

        // Fetch raw badge events
        const badges = await prisma.rawBadgeEvent.findMany({
            take: 200,
            orderBy: { time: "desc" },
            include: {
                participant: {
                    select: { name: true, email: true },
                },
            },
        });

        return NextResponse.json({ badges });
    } catch (err: any) {
        if (err.message.includes("Unauthorized")) {
            return NextResponse.json({ error: err.message }, { status: 403 });
        }
        console.error("Fetch badges error:", err);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
