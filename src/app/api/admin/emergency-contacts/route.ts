/* eslint-disable @typescript-eslint/no-unused-vars */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import prisma from "@/lib/prisma";
import { logBackendError } from "@/lib/logger";

export async function GET() {
    try {
        const session = await getServerSession(authOptions);
        const user = session?.user as {sysadmin?: boolean; boardMember?: boolean; keyholder?: boolean};

        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const isAdmin = user.sysadmin || user.boardMember || user.keyholder;

        if (!isAdmin) {
            return NextResponse.json({ error: "Forbidden: Keyholder privileges required." }, { status: 403 });
        }

        // Fetch all households where there is at least one participant enrolled.
        const households = await prisma.household.findMany({
            include: {
                participants: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        visits: {
                            where: { departed: null },
                            select: { id: true }
                        }
                    }
                },
                leads: {
                    include: {
                        participant: {
                            select: {
                                id: true,
                                name: true,
                                email: true,
                                phone: true
                            }
                        }
                    }
                }
            }
        });

        // Map and compute presence logic (is anyone from this household physically present right now?)
        const formattedHouseholds = households.map(h => {
            const isPresent = h.participants.some(p => p.visits.length > 0);
            
            return {
                id: h.id,
                name: h.name,
                emergencyContactName: h.emergencyContactName,
                emergencyContactPhone: h.emergencyContactPhone,
                isPresent,
                participants: h.participants.map(p => ({
                    id: p.id,
                    name: p.name,
                    isPresent: p.visits.length > 0
                })),
                leads: h.leads.map(l => ({
                    id: l.participant.id,
                    name: l.participant.name,
                    phone: l.participant.phone,
                    email: l.participant.email
                }))
            };
        });

        return NextResponse.json({ households: formattedHouseholds });

    } catch (error) {
        console.error("Emergency contacts API error:", error);
        await logBackendError(error, "GET /api/admin/emergency-contacts");
        return NextResponse.json(
            { error: "Internal Server Error fetching emergency contacts." },
            { status: 500 }
        );
    }
}
