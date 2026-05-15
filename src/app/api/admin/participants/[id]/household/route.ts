import prisma from "@/lib/prisma";
import { handler, badRequest, notFound } from "@/security/handler";

export const POST = handler<{ id: string }>('POST /api/admin/participants/[id]/household', async ({ req, params }) => {
    const participantId = parseInt(params.id);
    if (isNaN(participantId)) {
        throw badRequest(`Invalid participant ID: ${params.id}`);
    }

    const { householdId, createNew } = await req.json();

    if (!householdId && !createNew) {
        throw badRequest("Must provide either householdId or createNew boolean");
    }

    const participant = await prisma.participant.findUnique({ where: { id: participantId } });
    if (!participant) throw notFound("Participant not found");

    let targetHouseholdId: number;

    if (createNew) {
        const newHousehold = await prisma.household.create({
            data: {
                name: `${participant.name || 'User'}'s Household`,
                leads: {
                    create: {
                        participantId: participant.id
                    }
                }
            }
        });
        targetHouseholdId = newHousehold.id;

        await prisma.membership.create({
            data: {
                householdId: targetHouseholdId,
                type: 'HOUSEHOLD',
                active: true,
            }
        });
    } else {
        targetHouseholdId = parseInt(householdId);
        if (isNaN(targetHouseholdId)) {
            throw badRequest("Invalid household ID");
        }

        const household = await prisma.household.findUnique({ where: { id: targetHouseholdId } });
        if (!household) throw notFound("Household not found");
    }

    const updatedParticipant = await prisma.participant.update({
        where: { id: participantId },
        data: { householdId: targetHouseholdId },
        include: { household: true }
    });

    if (participant.householdId && participant.householdId !== targetHouseholdId) {
        await prisma.householdLead.deleteMany({
            where: {
                participantId: participant.id,
                householdId: participant.householdId
            }
        });
    }

    return { Participant: updatedParticipant };
});
