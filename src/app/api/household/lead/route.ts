import prisma from "@/lib/prisma";
import { handler, badRequest, notFound, unauthorized } from "@/security/handler";

export const POST = handler('POST /api/household/lead', async ({ req, auth }) => {
    if (auth.type !== 'session') throw unauthorized();
    const userId = auth.user.id;

    const body = await req.json();
    const { participantId } = body;

    if (!participantId) {
        throw badRequest("Participant ID is required");
    }

    const user = await prisma.participant.findUnique({
        where: { id: userId },
        include: { householdLeads: true }
    });

    if (!user?.householdId) {
        throw badRequest("You must create a household first");
    }

    const targetMember = await prisma.participant.findUnique({ where: { id: participantId } });
    if (!targetMember || targetMember.householdId !== user.householdId) {
        throw notFound("Member not found in your household");
    }

    const existingLead = await prisma.householdLead.findUnique({
        where: {
            householdId_participantId: {
                householdId: user.householdId,
                participantId: participantId
            }
        }
    });

    if (existingLead) {
        return { HouseholdLead: existingLead };
    }

    const newLead = await prisma.householdLead.create({
        data: {
            householdId: user.householdId,
            participantId: participantId
        }
    });

    await prisma.auditLog.create({
        data: {
            actorId: userId,
            action: "CREATE",
            tableName: "HouseholdLead",
            affectedEntityId: user.householdId,
            secondaryAffectedEntity: participantId,
            newData: JSON.stringify(newLead)
        }
    });

    return { HouseholdLead: newLead };
});

export const DELETE = handler('DELETE /api/household/lead', async ({ req, auth }) => {
    if (auth.type !== 'session') throw unauthorized();
    const userId = auth.user.id;

    const body = await req.json();
    const { participantId } = body;

    if (!participantId) {
        throw badRequest("Participant ID is required");
    }

    const user = await prisma.participant.findUnique({
        where: { id: userId },
        include: { householdLeads: true }
    });

    if (!user?.householdId) {
        throw badRequest("You must create a household first");
    }

    const targetMember = await prisma.participant.findUnique({ where: { id: participantId } });
    if (!targetMember || targetMember.householdId !== user.householdId) {
        throw notFound("Member not found in your household");
    }

    const allLeads = await prisma.householdLead.findMany({
        where: { householdId: user.householdId }
    });

    if (allLeads.length <= 1 && allLeads.some(l => l.participantId === participantId)) {
        throw badRequest("Cannot remove the last lead of a household.");
    }

    const existingLead = await prisma.householdLead.findUnique({
        where: {
            householdId_participantId: {
                householdId: user.householdId,
                participantId: participantId
            }
        }
    });

    if (!existingLead) {
        throw badRequest("Member is not a lead");
    }

    await prisma.householdLead.delete({
        where: {
            householdId_participantId: {
                householdId: user.householdId,
                participantId: participantId
            }
        }
    });

    await prisma.auditLog.create({
        data: {
            actorId: userId,
            action: "DELETE",
            tableName: "HouseholdLead",
            affectedEntityId: user.householdId,
            secondaryAffectedEntity: participantId,
            oldData: JSON.stringify(existingLead)
        }
    });

    return { HouseholdLead: existingLead };
});
