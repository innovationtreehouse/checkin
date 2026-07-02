import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { withAuth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { activityMembers } from "@/lib/household/activityMembers";

export const GET = withAuth({}, async (_req, auth) => {
    if (auth.type !== 'session') return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // activityMembers only reads session.user; reconstruct the minimal shape from auth.user.
    const session = { user: auth.user } as unknown as Session;

    try {
        // Self, or every household member when the session is a household lead.
        const householdMembers = await activityMembers(session);
        const householdMemberIds = householdMembers.map(m => m.id);

        const enrollments = await prisma.programParticipant.findMany({
            where: { personId: { in: householdMemberIds } },
            select: {
                programId: true,
                personId: true,
                person: { select: { id: true, name: true } },
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
});
