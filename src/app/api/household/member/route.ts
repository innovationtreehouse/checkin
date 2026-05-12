import prisma from "@/lib/prisma";
import { handler, badRequest, notFound, unauthorized } from "@/security/handler";

export const PATCH = handler('PATCH /api/household/member', async ({ req, auth }) => {
    if (auth.type !== 'session') throw unauthorized();
    const userId = auth.user.id;

    const body = await req.json();
    const { participantId, name, email, dob, phone, isLead } = body;

    if (!participantId) {
        throw badRequest("Participant ID is required");
    }

    const user = await prisma.participant.findUnique({ where: { id: userId }, include: { householdLeads: true } });

    if (!user?.householdId) {
        throw badRequest("You must create a household first");
    }

    const targetMember = await prisma.participant.findUnique({ where: { id: participantId } });
    if (!targetMember || targetMember.householdId !== user.householdId) {
        throw notFound("Member not found in your household");
    }

    const updatedMember = await prisma.participant.update({
        where: { id: participantId },
        data: {
            name: name !== undefined ? name : undefined,
            email: email !== undefined ? (email === "" ? null : email.toLowerCase()) : undefined,
            dob: dob !== undefined ? (dob === "" ? null : new Date(dob + "T12:00:00Z")) : undefined,
            phone: phone !== undefined ? (phone === "" ? null : phone) : undefined,
        }
    });

    if (isLead !== undefined && participantId !== userId) {
        const currentLead = await prisma.householdLead.findUnique({
            where: {
                householdId_participantId: { householdId: user.householdId, participantId }
            }
        });

        if (isLead && !currentLead) {
            await prisma.householdLead.create({
                data: {
                    householdId: user.householdId,
                    participantId
                }
            });
            await prisma.auditLog.create({
                data: {
                    actorId: userId,
                    action: "CREATE",
                    tableName: "HouseholdLead",
                    affectedEntityId: user.householdId,
                    secondaryAffectedEntity: participantId
                }
            });
        } else if (!isLead && currentLead) {
            const leadCount = await prisma.householdLead.count({ where: { householdId: user.householdId } });
            if (leadCount > 1) {
                await prisma.householdLead.delete({
                    where: {
                        householdId_participantId: { householdId: user.householdId, participantId }
                    }
                });

                await prisma.auditLog.create({
                    data: {
                        actorId: userId,
                        action: "DELETE",
                        tableName: "HouseholdLead",
                        affectedEntityId: user.householdId,
                        secondaryAffectedEntity: participantId
                    }
                });
            }
        }
    }

    await prisma.auditLog.create({
        data: {
            actorId: userId,
            action: "EDIT",
            tableName: "Participant",
            affectedEntityId: targetMember.id,
            newData: JSON.stringify(updatedMember)
        }
    });

    return { Participant: updatedMember };
});
