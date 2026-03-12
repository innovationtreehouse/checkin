import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";

export const GET = withAuth(
    {},
    async (_req, auth) => {
        try {
            if (auth.type !== 'session') return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
            const userId = auth.user.id;

            const user = await prisma.participant.findUnique({
                where: { id: userId },
                include: { household: { include: { participants: true, leads: true } } }
            });

            if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

            return NextResponse.json({ household: user.household }, { status: 200 });
        } catch (error: unknown) {
            console.error("Household GET Error:", error);
            return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
        }
    }
);

export const POST = withAuth(
    {},
    async (_req, auth) => {
        try {
            if (auth.type !== 'session') return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
            const userId = auth.user.id;

            const user = await prisma.participant.findUnique({ where: { id: userId } });
            if (user?.householdId) {
                return NextResponse.json({ error: "User already belongs to a household" }, { status: 400 });
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

            return NextResponse.json({ household }, { status: 201 });
        } catch (error: unknown) {
            console.error("Household POST Error:", error);
            return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
        }
    }
);

export const PATCH = withAuth(
    {},
    async (req, auth) => {
        try {
            if (auth.type !== 'session') return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
            const userId = auth.user.id;

            const body = await req.json();
            const { memberName, memberEmail, memberDob } = body;

            const user = await prisma.participant.findUnique({ where: { id: userId }, include: { householdLeads: true } });

            if (!user?.householdId) {
                return NextResponse.json({ error: "You must create a household first" }, { status: 400 });
            }

            const isLead = user.householdLeads.some(lead => lead.householdId === user.householdId);
            if (!isLead && !user.sysadmin) {
                return NextResponse.json({ error: "Only household leads can add members" }, { status: 403 });
            }

            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (memberEmail && !emailRegex.test(memberEmail)) {
                return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
            }

            let targetMember;

            if (memberEmail) {
                targetMember = await prisma.participant.findUnique({ where: { email: memberEmail.toLowerCase() } });

                if (targetMember) {
                    if (targetMember.householdId) {
                        return NextResponse.json({ error: "A user with this email already belongs to a household." }, { status: 400 });
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

            return NextResponse.json({ member: targetMember }, { status: 200 });
        } catch (error: unknown) {
            console.error("Household PATCH Error:", error);
            return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
        }
    }
);
