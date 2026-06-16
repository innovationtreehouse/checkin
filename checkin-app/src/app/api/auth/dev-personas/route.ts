import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import prisma from "@/lib/prisma";
import { config } from "@/lib/config";
import { authOptions } from "@/lib/auth-options";

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/dev-personas
 *
 * Returns @example.com personas (with role flags) that feed the persona picker. Available on
 * the dev instance and local laptops only. Middleware exempts /api, so on the cloud dev instance
 * we additionally require a session here — otherwise an anonymous visitor could enumerate the
 * persona list, violating the "not world-readable" rule. On local no session is required (the
 * logged-out picker is the initial login path).
 */
export async function GET() {
    if (process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: "Not available" }, { status: 404 });
    }
    if (!config.isDevInstance()) {
        return NextResponse.json({ error: "Not available" }, { status: 404 });
    }
    if (config.checkinEnv() === 'dev') {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: "Not available" }, { status: 404 });
        }
    }

    const personas = await prisma.participant.findMany({
        where: {
            email: { endsWith: "@example.com" },
        },
        select: {
            id: true,
            email: true,
            name: true,
            sysadmin: true,
            boardMember: true,
            keyholder: true,
            backgroundCheckReviewer: true,
            dob: true,
            householdId: true,
            toolStatuses: {
                select: {
                    toolId: true,
                    level: true,
                },
            },
        },
        orderBy: { id: "asc" },
    });

    return NextResponse.json({ personas });
}
