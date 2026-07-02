import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withAuth } from "@/lib/auth";
import { isYouth } from "@/lib/time";

export const GET = withAuth(
    {},
    async (_req, auth) => {
        if (auth.type !== 'session') return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const userId = auth.user.id;

        try {
            const user = await prisma.person.findUnique({
                where: { id: userId },
                include: {
                    householdLeads: true,
                    household: {
                        include: { emergencyContacts: { orderBy: [{ priority: "asc" }, { id: "asc" }] } },
                    },
                }
            });

            if (!user) {
                return NextResponse.json({ error: "Participant not found" }, { status: 404 });
            }

            // Youth are never required to provide a phone number (issue #169)
            const needsPhone = !user.phone && !isYouth(user.dateOfBirth);
            const isLead = user.householdId && user.householdLeads.some((lead: { id?: number; email?: string; name?: string; participantId?: number; level?: string; status?: string; role?: string; type?: string; [key: string]: unknown }) => lead.householdId === user.householdId);

            // A lead needs a contact when no valid (non-member, complete) one exists.
            const validContact = user.household?.emergencyContacts.find(
                (c) => c.conflictParticipantId === null && c.name.trim() && c.phone.trim(),
            );
            const primaryContact = user.household?.emergencyContacts[0];
            const needsEmergencyContact = isLead && !validContact;

            return NextResponse.json({
                phone: user.phone || "",
                needsPhone,
                isLead: Boolean(isLead),
                needsEmergencyContact: Boolean(needsEmergencyContact),
                emergencyContactName: primaryContact?.name || "",
                emergencyContactPhone: primaryContact?.phone || ""
            });
        } catch (error) {
            console.error("Error checking onboarding status:", error);
            return NextResponse.json({ error: "Failed to check status" }, { status: 500 });
        }
    }
);
