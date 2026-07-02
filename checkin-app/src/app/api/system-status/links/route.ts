import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";

// Link Status data source: recent external-integration failures.
export const GET = withAuth(
    { roles: ["isSysadmin", "isBoardMember"] },
    async () => {
        try {
            // 90-day TTL purge on read (admin opening the tab). ponytail: no cron needed.
            const ninetyDaysAgo = new Date();
            ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
            prisma.integrationErrorLog
                .deleteMany({ where: { timestamp: { lt: ninetyDaysAgo } } })
                .catch((err: unknown) => logger.error("Failed to purge old integration errors:", err));

            const errors = await prisma.integrationErrorLog.findMany({
                orderBy: [{ resolvedAt: "asc" }, { timestamp: "desc" }],
                take: 200,
            });

            return NextResponse.json({ errors });
        } catch (error) {
            logger.error("Failed to fetch integration errors:", error);
            return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
        }
    }
);
