import prisma from '@/lib/prisma';
import { handler, notFound, unauthorized } from "@/security/handler";

export const POST = handler('POST /api/profile/onboarding', async ({ req, auth }) => {
    if (auth.type !== 'session') throw unauthorized();
    const userId = auth.user.id;

    const body = await req.json();
    const { phone, emergencyContactName, emergencyContactPhone } = body;

    const user = await prisma.participant.findUnique({
        where: { id: userId },
        include: { householdLeads: true }
    });

    if (!user) {
        throw notFound("User not found");
    }

    if (phone !== undefined) {
        await prisma.participant.update({
            where: { id: userId },
            data: { phone }
        });
    }

    const isLead = user.householdId && user.householdLeads.some(lead => lead.householdId === user.householdId);
    if (isLead && user.householdId && (emergencyContactName !== undefined || emergencyContactPhone !== undefined)) {
        const updateData: Record<string, NonNullable<unknown> | null | string | number | boolean | Date> = {};
        if (emergencyContactName !== undefined) updateData.emergencyContactName = emergencyContactName;
        if (emergencyContactPhone !== undefined) updateData.emergencyContactPhone = emergencyContactPhone;

        await prisma.household.update({
            where: { id: user.householdId },
            data: updateData
        });
    }

    return { success: true };
});
