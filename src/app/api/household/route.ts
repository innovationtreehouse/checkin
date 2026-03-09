import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session || !session.user || !(session.user as {id: number}).id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const userId = (session.user as {id: number}).id;

        // Find the user to get their householdId
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

export async function POST(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session || !session.user || !(session.user as {id: number}).id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const userId = (session.user as {id: number}).id;
        const user = await prisma.participant.findUnique({ where: { id: userId } });
        if (user?.householdId) {
            return NextResponse.json({ error: "User already belongs to a household" }, { status: 400 });
        }

        // Derive household name from the lead's last name
        const lastName = user?.name?.trim().split(/\s+/).pop() || "";
        const householdName = lastName ? `${lastName} Household` : "Household";

        // Create a new household and set the user as the lead and a member
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

        // Create a HOUSEHOLD membership
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

export async function PATCH(req: NextRequest) {
    // This endpoint handles adding a new member (dependent or pre-registered adult) to the household
    try {
        const session = await getServerSession(authOptions);
        if (!session || !session.user || !(session.user as {id: number}).id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const userId = (session.user as {id: number}).id;
        const body = await req.json();
        const { memberName, memberEmail, memberDob } = body;

        const user = await prisma.participant.findUnique({ where: { id: userId }, include: { householdLeads: true } });

        if (!user?.householdId) {
            return NextResponse.json({ error: "You must create a household first" }, { status: 400 });
        }

        // Check if user is a lead
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

                // Link existing member to household
                targetMember = await prisma.participant.update({
                    where: { id: targetMember.id },
                    data: { householdId: user.householdId }
                });
            }
        }

        // If no existing user was found (or no email provided), create a new one
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
