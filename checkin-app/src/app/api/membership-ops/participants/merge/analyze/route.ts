import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { LIVE_PERSON } from "@/lib/person/filters";
import { householdMembershipStatus } from "../membershipGuard";

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
                                // Public-tier; feeds the membership-mismatch warning the
                                // POST guard enforces (see ../membershipGuard.ts).
                                orgMembership: { select: { status: true } },
                                householdMembers: {
                                    // Tombstones are not members: the page's
                                    // isLeadWithOthers guard must match the POST's.
                                    where: LIVE_PERSON,
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

            // Mirrors the POST guard so the picker can warn before the operator
            // commits. Direction-agnostic: the keeper isn't chosen until the UI
            // scores/swaps, and any difference blocks the merge either way.
            const statusA = householdMembershipStatus(pA.household);
            const statusB = householdMembershipStatus(pB.household);
            const membershipMismatch = statusA === statusB ? null : { a: statusA, b: statusB };

            return NextResponse.json({ participants: [pA, pB], membershipMismatch });
        } catch (error) {
            logger.error("Failed to analyze participants:", error);
            return apiError("Server error", 500);
        }
    }
);
