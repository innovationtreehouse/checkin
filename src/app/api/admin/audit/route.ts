/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import prisma from "@/lib/prisma";

export async function GET() {
    // Only Sysadmins can view audit logs
    const session = await getServerSession(authOptions);
    const isSysAdmin = (session?.user as any)?.sysadmin;

    if (!session || !isSysAdmin) {
        return NextResponse.json({ error: "Forbidden: Only Admin can view Audit Logs" }, { status: 403 });
    }

    try {
        const logs = await prisma.auditLog.findMany({
            orderBy: { time: 'desc' },
            take: 100 // Limit for performance
        });

        return NextResponse.json({ logs });
    } catch (error) {
        console.error("Failed to fetch audit logs:", error);
        return NextResponse.json({ error: "Failed to fetch audit logs" }, { status: 500 });
    }
}
