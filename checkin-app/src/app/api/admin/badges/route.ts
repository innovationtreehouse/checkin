import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";

export const GET = withAuth(
    { roles: ['sysadmin', 'boardMember'] },
    async () => {
        try {
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
        } catch (error) {
            console.error("Fetch badges error:", error);
            return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
        }
    }
);
