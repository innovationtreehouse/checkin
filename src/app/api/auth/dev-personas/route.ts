import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

/**
 * GET /api/auth/dev-personas
 *
 * Dev-only endpoint that returns all @example.com participants
 * with their role flags for the dev login picker.
 */
export async function GET() {
    // Block in production
    if (process.env.NODE_ENV === "production") {
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
