/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import prisma from '@/lib/prisma';

export async function GET(req: Request) {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as any).id;
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

        // A user needs onboarding if they are an adult (or generic user, we enforce it for everyone login) without a phone number.
        // If they are a household lead, they also need to provide an emergency contact.
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
