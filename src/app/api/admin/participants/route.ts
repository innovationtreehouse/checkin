import prisma from "@/lib/prisma";
import { handler, badRequest } from "@/security/handler";

export const POST = handler('POST /api/admin/participants', async ({ req }) => {
    const body = await req.json();
    const { name, email, parentEmail, dob, householdId } = body;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!email && !parentEmail && !householdId) {
        throw badRequest("Email, Parent Email, or Household assignment is required");
    }

    if (email && !emailRegex.test(email)) {
        throw badRequest("Invalid email format");
    }

    if (parentEmail && !emailRegex.test(parentEmail)) {
        throw badRequest("Invalid parent email format");
    }

    if (email) {
        const existingUser = await prisma.participant.findUnique({
            where: { email }
        });

        if (existingUser) {
            throw badRequest("A participant with this email already exists");
        }
    }

    let householdIdToAssign: number | null = null;

    if (parentEmail) {
        let parent = await prisma.participant.findUnique({
            where: { email: parentEmail }
        });

        if (!parent) {
            parent = await prisma.participant.create({
                data: {
                    email: parentEmail,
                }
            });
        }

        if (!parent.householdId) {
            const parentLastName = (parent.name || "").trim().split(/\s+/).pop() || "";
            const household = await prisma.household.create({
                data: {
                    name: parentLastName ? `${parentLastName} Household` : "Household",
                    leads: {
                        create: { participantId: parent.id }
                    }
                }
            });
            await prisma.participant.update({
                where: { id: parent.id },
                data: { householdId: household.id }
            });
            householdIdToAssign = household.id;

            await prisma.membership.create({
                data: {
                    householdId: household.id,
                    type: 'HOUSEHOLD',
                    active: true,
                }
            });
        } else {
            householdIdToAssign = parent.householdId;
        }
    }

    const newParticipant = await prisma.participant.create({
        data: {
            name,
            ...(email && { email }),
            dob: dob ? new Date(dob).toISOString() : null,
            ...(householdIdToAssign && { householdId: householdIdToAssign })
        }
    });

    if (householdId && !householdIdToAssign) {
        await prisma.participant.update({
            where: { id: newParticipant.id },
            data: { householdId: householdId }
        });
    }
    else if (!parentEmail && !householdId) {
        const lastName = (name || "").trim().split(/\s+/).pop() || "";
        const newHousehold = await prisma.household.create({
            data: {
                name: lastName ? `${lastName} Household` : "Household",
                leads: {
                    create: { participantId: newParticipant.id }
                }
            }
        });

        await prisma.participant.update({
            where: { id: newParticipant.id },
            data: { householdId: newHousehold.id }
        });

        await prisma.membership.create({
            data: {
                householdId: newHousehold.id,
                type: 'HOUSEHOLD',
                active: true,
            }
        });
    }

    return { Participant: newParticipant };
});
