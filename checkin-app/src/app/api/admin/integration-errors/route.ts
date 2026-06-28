import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";

// Link Status data source: recent external-integration failures.
export const GET = withAuth(
    { roles: ["sysadmin", "boardMember"] },
    async () => {
        try {
            // 90-day TTL purge on read (admin opening the tab). ponytail: no cron needed.
            const ninetyDaysAgo = new Date();
            ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
            prisma.integrationError
                .deleteMany({ where: { createdAt: { lt: ninetyDaysAgo } } })
                .catch((err: unknown) => console.error("Failed to purge old integration errors:", err));

            const errors = await prisma.integrationError.findMany({
                orderBy: [{ resolvedAt: "asc" }, { createdAt: "desc" }],
                take: 200,
            });

            return NextResponse.json({ errors });
        } catch (error) {
            console.error("Failed to fetch integration errors:", error);
            return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
        }
    }
);
