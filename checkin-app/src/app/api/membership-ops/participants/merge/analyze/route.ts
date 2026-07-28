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
                    // Explicit select, not a bare include — an include returns the whole
                    // Person row (allergies, notificationSettings, emailVerified,
                    // lastBackgroundCheck, waiverSignedBy, ...) plus the whole Household
                    // (intakeNotes, line1/city/state/postalCode), and a plain
                    // `householdMembers: true` returns full Person rows one level down for
                    // people who aren't even being merged.
                    // googleId/dateOfBirth ARE deliberately kept on the two merge subjects:
                    // they're 2 of the 5 CONFLICT_FIELDS the merge field-picker compares
                    // (see ../route.ts), and googleIdIdentity() renders the account behind a
                    // googleId conflict. Stripping them silently breaks the picker.
                    // Household members get only id/name/isHouseholdLead — all the merge page
                    // renders (name, "(This)" self-marker, [Lead] marker, isLeadWithOthers
                    // guard and others-count).
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        phone: true,
                        googleId: true,
                        // Lets the merge picker label which side's identity is
                        // verified/controlled (the login identity resolves as one
                        // unit — see ../route.ts). Kept explicit, not a bare include.
                        emailVerified: true,
                        dateOfBirth: true,
                        mergedIntoId: true,
                        household: {
                            select: {
                                id: true,
                                name: true,
                                householdMembers: {
                                    select: { id: true, name: true, isHouseholdLead: true }
                                }
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
