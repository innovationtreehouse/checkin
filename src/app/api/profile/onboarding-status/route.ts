import prisma from '@/lib/prisma';
import { handler, notFound, unauthorized } from "@/security/handler";

export const GET = handler('GET /api/profile/onboarding-status', async ({ auth }) => {
    if (auth.type !== 'session') throw unauthorized();
    const userId = auth.user.id;

    const user = await prisma.participant.findUnique({
        where: { id: userId },
        include: {
            householdLeads: true,
            household: true
        }
    });

    if (!user) {
        throw notFound("Participant not found");
    }

    const needsPhone = !user.phone;
    const isLead = user.householdId && user.householdLeads.some(lead => lead.householdId === user.householdId);
    const needsEmergencyContact = isLead && (!user.household?.emergencyContactName || !user.household?.emergencyContactPhone);

    return {
        phone: user.phone || "",
        needsPhone,
        isLead: Boolean(isLead),
        needsEmergencyContact: Boolean(needsEmergencyContact),
        emergencyContactName: user.household?.emergencyContactName || "",
        emergencyContactPhone: user.household?.emergencyContactPhone || ""
    };
});
