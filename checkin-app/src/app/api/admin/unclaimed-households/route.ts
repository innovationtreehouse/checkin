import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";

export const dynamic = 'force-dynamic';

export const GET = withAuth(
    { roles: ['sysadmin', 'boardMember'] },
    async () => {
        try {
            // Households with at least one participant that has an email but no
            // Google sign-in yet (account created at registration, never claimed).
            const households = await prisma.household.findMany({
                where: {
                    participants: { some: { email: { not: null }, googleId: null } }
                },
                include: { participants: true }
            });

            const result = households.map(h => ({
                id: h.id,
                name: h.name
                    || h.participants.find(p => p.name)?.name
                    || `Household #${h.id}`,
                hasClaimedMember: h.participants.some(p => p.googleId !== null),
                members: h.participants
                    .filter(p => p.email !== null && p.googleId === null)
                    .map(p => ({ id: p.id, name: p.name, email: p.email }))
            }));

            return NextResponse.json({ households: result });
        } catch (error) {
            console.error("Failed to fetch unclaimed households:", error);
            return NextResponse.json({ error: "Failed to fetch unclaimed households" }, { status: 500 });
        }
    }
);
