import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";

export const GET = withAuth(
    { roles: ['isSysadmin', 'isBoardMember'] },
    async () => {
        try {
            const errors = await prisma.errorLog.findMany({
                orderBy: { timestamp: "desc" },
                take: 100,
            });
            return NextResponse.json({ errors });
        } catch (error) {
            logger.error("Failed to fetch error logs:", error);
            return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
        }
    }
);
