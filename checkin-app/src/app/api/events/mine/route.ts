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
        const members = await activityMembers(session);
        const memberIds = members.map(m => m.id);
        const memberById = new Map(members.map(m => [m.id, m]));

        // Which members are tied to which programs (enrolled or volunteering).
        const [enrolled, volunteers] = await Promise.all([
            prisma.programParticipant.findMany({
                where: { participantId: { in: memberIds } },
                select: { participantId: true, programId: true }
            }),
            prisma.programVolunteer.findMany({
                where: { participantId: { in: memberIds } },
                select: { participantId: true, programId: true }
            })
        ]);

        const programMembers = new Map<number, Set<number>>();
        for (const { programId, participantId } of [...enrolled, ...volunteers]) {
            let set = programMembers.get(programId);
            if (!set) programMembers.set(programId, (set = new Set()));
            set.add(participantId);
        }

        const events = await prisma.event.findMany({
            where: {
                programId: { in: [...programMembers.keys()] },
                endAt: { gte: new Date() } // Only upcoming
            },
            orderBy: { startAt: "asc" },
            include: {
                program: { select: { name: true } },
                rsvps: {
                    where: { participantId: { in: memberIds } },
                    select: { participantId: true, status: true }
                }
            }
        });

        // One card per (event, member-in-that-program), each with that member's
        // own RSVP — so a household lead can respond for each family member.
        const rows = events.flatMap((ev: typeof events[number]) => {
            const attendees = ev.programId ? programMembers.get(ev.programId) : undefined;
            if (!attendees) return [];
            return memberIds
                .filter(id => attendees.has(id))
                .map(pid => ({
                    id: ev.id,
                    name: ev.name,
                    description: ev.description,
                    startAt: ev.startAt,
                    endAt: ev.endAt,
                    program: ev.program,
                    participant: memberById.get(pid),
                    rsvp: ev.rsvps.find((r: typeof ev.rsvps[number]) => r.participantId === pid)?.status ?? null
                }));
        });

        return NextResponse.json(rows);
    } catch (error) {
        console.error("Failed to fetch user events:", error);
        return NextResponse.json({ error: "Failed to fetch events" }, { status: 500 });
    }
});
