import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";

export const GET = withAuth(
    { roles: ['sysadmin'] },
    async () => {
        try {
            const logs = await prisma.auditLog.findMany({
                orderBy: { time: 'desc' },
                take: 100
            });

            return NextResponse.json({ logs });
        } catch (error) {
            console.error("Failed to fetch audit logs:", error);
            return NextResponse.json({ error: "Failed to fetch audit logs" }, { status: 500 });
        }
    }
);
