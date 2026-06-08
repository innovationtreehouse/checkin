import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { config } from "@/lib/config";

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/dev-personas
 *
 * Local-only endpoint that returns all @example.com participants with their role flags
 * for the offline login picker. Gated to CHECKIN_ENV=local (developer laptops); the cloud
 * dev instance uses the separate gated mint flow, not this open picker.
 */
export async function GET() {
    if (!config.isLocal()) {
        return NextResponse.json({ error: "Not available" }, { status: 404 });
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
            shopSteward: true,
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
