/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withAuth } from "@/lib/auth";

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

            const needsPhone = !user.phone;
            const isLead = user.householdId && user.householdLeads.some((lead: any) => lead.householdId === user.householdId);
            
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
