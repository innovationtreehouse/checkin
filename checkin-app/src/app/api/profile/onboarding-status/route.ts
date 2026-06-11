import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withAuth } from "@/lib/auth";
import { isMinor } from "@/lib/time";

export const GET = withAuth(
    {},
    async (_req, auth) => {
        if (auth.type !== 'session') return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const userId = auth.user.id;

        try {
            const user = await prisma.participant.findUnique({
                where: { id: userId },
                include: {
                    householdLeads: true,
                    household: true
                }
            });

            if (!user) {
                return NextResponse.json({ error: "Participant not found" }, { status: 404 });
            }

            // Minors are never required to provide a phone number (issue #169)
            const needsPhone = !user.phone && !isMinor(user.dob);
            const isLead = user.householdId && user.householdLeads.some((lead: { id?: number; email?: string; name?: string; participantId?: number; level?: string; status?: string; role?: string; type?: string; [key: string]: unknown }) => lead.householdId === user.householdId);
            
            const needsEmergencyContact = isLead && (!user.household?.emergencyContactName || !user.household?.emergencyContactPhone);

            return NextResponse.json({
                phone: user.phone || "",
                needsPhone,
                isLead: Boolean(isLead),
                needsEmergencyContact: Boolean(needsEmergencyContact),
                emergencyContactName: user.household?.emergencyContactName || "",
                emergencyContactPhone: user.household?.emergencyContactPhone || ""
            });
        } catch (error) {
            console.error("Error checking onboarding status:", error);
            return NextResponse.json({ error: "Failed to check status" }, { status: 500 });
        }
    }
);
