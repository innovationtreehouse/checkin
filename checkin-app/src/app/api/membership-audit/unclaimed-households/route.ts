import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";

export const dynamic = 'force-dynamic';

export const GET = withAuth(
    { roles: ['isSysadmin', 'isBoardMember'] },
    async () => {
        try {
            // A household is "claimed" once any of its household leads has signed in
            // with Google. We can't expect every member (e.g. students) to ever log
            // in, so claiming hinges on leads only. Unclaimed = no lead has signed in
            // yet, but at least one lead has an email we can chase.
            const households = await prisma.household.findMany({
                where: {
                    leads: { some: { participant: { email: { not: null } } } },
                    NOT: { leads: { some: { participant: { googleId: { not: null } } } } }
                },
                include: { leads: { include: { participant: true } } }
            });

            const result = households.map(h => ({
                id: h.id,
                name: h.name
                    || h.leads.find(l => l.participant.name)?.participant.name
                    || `Household #${h.id}`,
                members: h.leads
                    .map(l => l.participant)
                    .filter(p => p.email !== null)
                    .map(p => ({ id: p.id, name: p.name, email: p.email }))
            }));

            return NextResponse.json({ households: result });
        } catch (error) {
            console.error("Failed to fetch unclaimed households:", error);
            return NextResponse.json({ error: "Failed to fetch unclaimed households" }, { status: 500 });
        }
    }
);
