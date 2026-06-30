import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth-options";
import prisma from "@/lib/prisma";
import { activityMembers } from "@/lib/household/activityMembers";

export async function GET() {
    const session = await getServerSession(authOptions);

    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        // Self, or every household member when the session is a household lead.
        const members = await activityMembers(session);
        const memberIds = members.map(m => m.id);

        const enrollments = await prisma.programParticipant.findMany({
            where: { participantId: { in: memberIds } },
            select: {
                programId: true,
                participantId: true,
                participant: { select: { id: true, name: true } },
                program: {
                    select: { id: true, name: true, startAt: true, endAt: true }
                }
            },
            orderBy: { program: { startAt: "asc" } }
        });

        return NextResponse.json(enrollments);
    } catch (error) {
        console.error("Failed to fetch user programs:", error);
        return NextResponse.json({ error: "Failed to fetch programs" }, { status: 500 });
    }
}
