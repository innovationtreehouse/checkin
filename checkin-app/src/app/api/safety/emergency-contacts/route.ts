import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { logBackendError } from "@/lib/logger";
import { apiError } from "@/lib/api-response";

export const GET = withAuth(
    { roles: ['isSysadmin', 'isBoardMember', 'isKeyholder'] },
    async () => {
        try {
            const households = await prisma.household.findMany({
                include: {
                    householdMembers: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            visits: {
                                where: { departedAt: null },
                                select: { id: true }
                            }
                        }
                    },
                    leads: {
                        include: {
                            person: {
                                select: {
                                    id: true,
                                    name: true,
                                    email: true,
                                    phone: true
                                }
                            }
                        }
                    },
                    emergencyContacts: {
                        orderBy: [{ priority: "asc" }, { id: "asc" }]
                    }
                }
            });

            const formattedHouseholds = households.map(h => {
                const isPresent = h.householdMembers.some(p => p.visits.length > 0);
                const contacts = h.emergencyContacts.map(c => ({
                    id: c.id,
                    name: c.name,
                    phone: c.phone,
                    email: c.email,
                    relationship: c.relationship,
                    // Invalid == flagged as a household member (kept for audit).
                    invalid: c.conflictParticipantId !== null || !c.name.trim() || !c.phone.trim(),
                }));
                const primaryValid = contacts.find(c => !c.invalid) ?? null;

                return {
                    id: h.id,
                    name: h.name,
                    // Back-compat fields: the primary valid contact.
                    emergencyContactName: primaryValid?.name ?? null,
                    emergencyContactPhone: primaryValid?.phone ?? null,
                    emergencyContacts: contacts,
                    isPresent,
                    householdMembers: h.householdMembers.map(p => ({
                        id: p.id,
                        name: p.name,
                        isPresent: p.visits.length > 0
                    })),
                    leads: h.leads.map(l => ({
                        id: l.person.id,
                        name: l.person.name,
                        phone: l.person.phone,
                        email: l.person.email
                    }))
                };
            });

            return NextResponse.json({ households: formattedHouseholds });
        } catch (error) {
            await logBackendError(error, "GET /api/safety/emergency-contacts");
            return apiError("Internal Server Error fetching emergency contacts.", 500);
        }
    }
);
