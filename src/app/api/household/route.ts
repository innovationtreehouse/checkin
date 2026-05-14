import prisma from "@/lib/prisma";
import { handler, badRequest, notFound, unauthorized } from "@/security/handler";

export const GET = handler('GET /api/household', async ({ auth }) => {
    if (auth.type !== 'session') throw unauthorized();
    const userId = auth.user.id;

    const user = await prisma.participant.findUnique({
        where: { id: userId },
        include: { household: { include: { participants: true, leads: true, memberships: { where: { active: true } } } } }
    });

    if (!user) throw notFound("User not found");

    return { Household: user.household };
});

export const POST = handler('POST /api/household', async ({ auth }) => {
    if (auth.type !== 'session') throw unauthorized();
    const userId = auth.user.id;

    const user = await prisma.participant.findUnique({ where: { id: userId } });
    if (user?.householdId) {
        throw badRequest("User already belongs to a household");
    }

    const lastName = (user?.name || "").trim().split(/\s+/).pop() || "";
    const householdName = lastName ? `${lastName} Household` : "Household";

    const household = await prisma.household.create({
        data: {
            name: householdName,
            address: user?.homeAddress || "",
            leads: {
                create: { participantId: userId }
            },
            participants: {
                connect: { id: userId }
            }
        },
        include: { participants: true, leads: true }
    });

    await prisma.membership.create({
        data: {
            householdId: household.id,
            type: 'HOUSEHOLD',
            active: true,
        }
    });

    await prisma.auditLog.create({
        data: {
            actorId: userId,
            action: "CREATE",
            tableName: "Household",
            affectedEntityId: household.id,
            newData: JSON.stringify(household)
        }
    });

    return { household };
});

export const PATCH = handler('PATCH /api/household', async ({ req, auth }) => {
    if (auth.type !== 'session') throw unauthorized();
    const userId = auth.user.id;

    const body = await req.json();
    const { memberName, memberEmail, memberDob } = body;

    const user = await prisma.participant.findUnique({ where: { id: userId }, include: { householdLeads: true } });

    if (!user?.householdId) {
        throw badRequest("You must create a household first");
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (memberEmail && !emailRegex.test(memberEmail)) {
        throw badRequest("Invalid email format");
    }

    let targetMember;

    if (memberEmail) {
        targetMember = await prisma.participant.findUnique({ where: { email: memberEmail.toLowerCase() } });

        if (targetMember) {
            if (targetMember.householdId) {
                throw badRequest("A user with this email already belongs to a household.");
            }

            targetMember = await prisma.participant.update({
                where: { id: targetMember.id },
                data: { householdId: user.householdId }
            });
        }
    }

    if (!targetMember) {
        targetMember = await prisma.participant.create({
            data: {
                name: memberName,
                ...(memberEmail && { email: memberEmail.toLowerCase() }),
                dob: memberDob ? new Date(memberDob) : null,
                householdId: user.householdId,
            }
        });
    }

    await prisma.auditLog.create({
        data: {
            actorId: userId,
            action: "EDIT",
            tableName: "Participant",
            affectedEntityId: targetMember.id,
            newData: JSON.stringify({ householdId: user.householdId, email: targetMember.email, name: targetMember.name })
        }
    });

    return { Participant: targetMember };
});
