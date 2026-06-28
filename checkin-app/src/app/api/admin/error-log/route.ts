import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";

export const GET = withAuth(
    { roles: ['sysadmin', 'boardMember'] },
    async () => {
        try {
            const errors = await prisma.errorLog.findMany({
                orderBy: { createdAt: "desc" },
                take: 100,
            });
            return NextResponse.json({ errors });
        } catch (error) {
            console.error("Failed to fetch error logs:", error);
            return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
        }
    }
);
