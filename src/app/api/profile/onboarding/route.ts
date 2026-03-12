/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withAuth } from "@/lib/auth";

export const POST = withAuth(
    {},
    async (req, auth) => {
        if (auth.type !== 'session') return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const userId = auth.user.id;

        try {
            const body = await req.json();
            const { phone, emergencyContactName, emergencyContactPhone } = body;

            const user = await prisma.participant.findUnique({
                where: { id: userId },
                include: { householdLeads: true }
            });

            if (!user) {
                return NextResponse.json({ error: "User not found" }, { status: 404 });
            }

            if (phone !== undefined) {
                await prisma.participant.update({
                    where: { id: userId },
                    data: { phone }
                });
            }

            const isLead = user.householdId && user.householdLeads.some((lead: any) => lead.householdId === user.householdId);
            if (isLead && user.householdId && (emergencyContactName !== undefined || emergencyContactPhone !== undefined)) {
                const updateData: any = {};
                if (emergencyContactName !== undefined) updateData.emergencyContactName = emergencyContactName;
                if (emergencyContactPhone !== undefined) updateData.emergencyContactPhone = emergencyContactPhone;
                
                await prisma.household.update({
                    where: { id: user.householdId },
                    data: updateData
                });
            }

            return NextResponse.json({ success: true });
        } catch (error) {
            console.error("Error saving onboarding details:", error);
            return NextResponse.json({ error: "Failed to save data" }, { status: 500 });
        }
    }
);
