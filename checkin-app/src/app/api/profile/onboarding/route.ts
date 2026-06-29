import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withAuth } from "@/lib/auth";
import { upsertPrimaryContact, EmergencyContactError } from "@/lib/emergencyContacts/service";
import { isValidPhone, PHONE_ERROR } from "@/lib/phone";

export const POST = withAuth(
    {},
    async (req, auth) => {
        if (auth.type !== 'session') return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const userId = auth.user.id;

        try {
            const body = await req.json();
            const { phone, emergencyContactName, emergencyContactPhone, emergencyContactEmail } = body;

            const user = await prisma.participant.findUnique({
                where: { id: userId },
                include: { householdLeads: true }
            });

            if (!user) {
                return NextResponse.json({ error: "User not found" }, { status: 404 });
            }

            if (phone !== undefined) {
                if (phone !== "" && !isValidPhone(phone)) {
                    return NextResponse.json({ error: PHONE_ERROR }, { status: 400 });
                }
                await prisma.participant.update({
                    where: { id: userId },
                    data: { phone }
                });
            }

            const isLead = user.householdId && user.householdLeads.some((lead: { id?: number; email?: string; name?: string; participantId?: number; level?: string; status?: string; role?: string; type?: string; [key: string]: unknown }) => lead.householdId === user.householdId);
            if (isLead && user.householdId && (emergencyContactName !== undefined || emergencyContactPhone !== undefined || emergencyContactEmail !== undefined)) {
                // Emergency contact is a separate entity; onboarding edits the
                // household's primary contact. Rejects a member as the contact.
                await upsertPrimaryContact(prisma, user.householdId, {
                    name: emergencyContactName,
                    phone: emergencyContactPhone,
                    email: emergencyContactEmail,
                });
            }

            return NextResponse.json({ success: true });
        } catch (error) {
            if (error instanceof EmergencyContactError) {
                return NextResponse.json({ error: error.message }, { status: 400 });
            }
            console.error("Error saving onboarding details:", error);
            return NextResponse.json({ error: "Failed to save data" }, { status: 500 });
        }
    }
);
