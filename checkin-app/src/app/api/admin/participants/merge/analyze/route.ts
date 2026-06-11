import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";

export const dynamic = 'force-dynamic';

export const GET = withAuth(
    { roles: ['sysadmin', 'boardMember'] },
    async (req) => {
        try {
            const url = new URL(req.url);
            const aId = parseInt(url.searchParams.get('a') || '0');
            const bId = parseInt(url.searchParams.get('b') || '0');

            if (!aId || !bId) {
                return NextResponse.json({ error: "Missing IDs" }, { status: 400 });
            }

            const getParticipant = async (id: number) => {
                const p = await prisma.participant.findUnique({
                    where: { id },
                    include: {
                        household: {
                            include: {
                                participants: true,
                                leads: true
                            }
                        },
                        _count: {
                            select: {
                                rawBadgeEvents: true,
                                visits: true,
                                programParticipants: true,
                                programVolunteers: true
                            }
                        }
                    }
                });
                return p;
            };

            const [pA, pB] = await Promise.all([getParticipant(aId), getParticipant(bId)]);

            if (!pA || !pB) {
                return NextResponse.json({ error: "Participant not found" }, { status: 404 });
            }

            return NextResponse.json({ participants: [pA, pB] });
        } catch (error) {
            console.error("Failed to analyze participants:", error);
            return NextResponse.json({ error: "Server error" }, { status: 500 });
        }
    }
);
