import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { logBackendError } from "@/lib/logger";

export const GET = withAuth(
    { roles: ['sysadmin', 'boardMember', 'keyholder'] },
    async () => {
        try {
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
);
