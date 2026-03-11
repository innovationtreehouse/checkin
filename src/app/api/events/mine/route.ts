/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import prisma from "@/lib/prisma";

export async function GET(req: Request) {
    const session = await getServerSession(authOptions);

    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const userId = parseInt((session.user as any).id, 10);

        // Get programs the user is in
        const enrolledPrograms = await prisma.programParticipant.findMany({
            where: { participantId: userId },
            select: { programId: true }
        });
        const volunteerPrograms = await prisma.programVolunteer.findMany({
            where: { participantId: userId },
            select: { programId: true }
        });

        const programIds = [
            ...enrolledPrograms.map(p => p.programId),
            ...volunteerPrograms.map(p => p.programId)
        ];

        // Fetch upcoming events for these programs
        const events = await prisma.event.findMany({
            where: {
                programId: { in: programIds },
                end: { gte: new Date() } // Only upcoming
            },
            orderBy: { start: 'asc' },
            include: {
                program: { select: { name: true } },
                rsvps: {
                    where: { participantId: userId }
                }
            }
        });

        return NextResponse.json(events);
    } catch (error) {
        console.error("Failed to fetch user events:", error);
        return NextResponse.json({ error: "Failed to fetch events" }, { status: 500 });
    }
}
