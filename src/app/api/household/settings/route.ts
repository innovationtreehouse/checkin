import prisma from "@/lib/prisma";
import { handler, notFound, unauthorized } from "@/security/handler";

export const PATCH = handler('PATCH /api/household/settings', async ({ req, auth }) => {
    if (auth.type !== 'session') throw unauthorized();
    const userId = auth.user.id;

    const body = await req.json();
    const { emergencyContactName, emergencyContactPhone, address } = body;

    const user = await prisma.participant.findUnique({
        where: { id: userId },
        include: { householdLeads: true }
    });

    if (!user || !user.householdId) {
        throw notFound("Household not found");
    }

    const updatedHousehold = await prisma.household.update({
        where: { id: user.householdId },
        data: {
            emergencyContactName: emergencyContactName !== undefined ? emergencyContactName : undefined,
            emergencyContactPhone: emergencyContactPhone !== undefined ? emergencyContactPhone : undefined,
            address: address !== undefined ? address : undefined,
        }
    });

    await prisma.auditLog.create({
        data: {
            actorId: userId,
            action: "EDIT",
            tableName: "Household",
            affectedEntityId: user.householdId,
            newData: JSON.stringify({ emergencyContactName, emergencyContactPhone, address })
        }
    });

    return { Household: updatedHousehold };
});
