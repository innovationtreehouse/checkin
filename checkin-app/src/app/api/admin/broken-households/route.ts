import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// "Broken" households have no household lead at all (zero HouseholdLead rows).
// Most arrive this way via Zoho import without a designated primary contact —
// a registered family that nobody can claim, because claiming requires a lead.
// Empty households (no participants) are included so the board can see them,
// even though there's no one to promote.
export const GET = withAuth(
    { roles: ["sysadmin", "boardMember"] },
    async () => {
        try {
            const households = await prisma.household.findMany({
                where: { leads: { none: {} } },
                include: {
                    participants: {
                        select: { id: true, name: true, dateOfBirth: true },
                        orderBy: { id: "asc" },
                    },
                },
                orderBy: { name: "asc" },
            });

            const result = households.map(h => ({
                id: h.id,
                name: h.name || `Household #${h.id}`,
                members: h.participants.map(p => ({ id: p.id, name: p.name, dateOfBirth: p.dateOfBirth })),
            }));

            return NextResponse.json({ households: result });
        } catch (error) {
            console.error("Failed to fetch broken households:", error);
            return NextResponse.json({ error: "Failed to fetch broken households" }, { status: 500 });
        }
    }
);
