import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";

export const GET = withAuth(
    { roles: ['isSysadmin', 'isBoardMember'] },
    async () => {
        try {
            const badges = await prisma.rawBadgeLog.findMany({
                take: 200,
                orderBy: { timestamp: "desc" },
                include: {
                    person: {
                        select: { name: true, email: true },
                    },
                },
            });

            return NextResponse.json({ badges });
        } catch (error) {
            logger.error("Fetch badges error:", error);
            return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
        }
    }
);
