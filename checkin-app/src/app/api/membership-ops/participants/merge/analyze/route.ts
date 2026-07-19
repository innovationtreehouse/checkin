import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";

export const dynamic = 'force-dynamic';

export const GET = withAuth(
    { roles: ['isSysadmin', 'isBoardMember'] },
    async (req) => {
        try {
            const url = new URL(req.url);
            const aId = parseInt(url.searchParams.get('a') || '0');
            const bId = parseInt(url.searchParams.get('b') || '0');

            if (!aId || !bId) {
                return apiError("Missing IDs", 400);
            }

            const getParticipant = async (id: number) => {
                const p = await prisma.person.findUnique({
                    where: { id },
                    include: {
                        household: {
                            include: {
                                householdMembers: true
                            }
                        },
                        _count: {
                            select: {
                                rawBadgeLogs: true,
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
                return apiError("Participant not found", 404);
            }

            if (pA.mergedIntoId != null || pB.mergedIntoId != null) {
                return apiError("Cannot analyze: one of these participants has already been merged.", 409);
            }

            return NextResponse.json({ participants: [pA, pB] });
        } catch (error) {
            logger.error("Failed to analyze participants:", error);
            return apiError("Server error", 500);
        }
    }
);
