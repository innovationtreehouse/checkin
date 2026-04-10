import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { authenticateRequest } from "@/lib/auth";

export async function POST(req: NextRequest) {
    const auth = await authenticateRequest(req);
    if (auth.type !== 'session') {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!auth.user.sysadmin && !auth.user.boardMember) {
        return NextResponse.json({ error: "Forbidden: Admin access required" }, { status: 403 });
    }

    try {
        const body = await req.json();
        const { name, email, parentEmail, dob, householdId } = body;

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!email && !parentEmail && !householdId) {
            return NextResponse.json({ error: "Email, Parent Email, or Household assignment is required" }, { status: 400 });
        }

        if (email && !emailRegex.test(email)) {
             return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
        }
        
        if (parentEmail && !emailRegex.test(parentEmail)) {
             return NextResponse.json({ error: "Invalid parent email format" }, { status: 400 });
        }

        if (email) {
            const existingUser = await prisma.participant.findUnique({
                where: { email }
            });

            if (existingUser) {
                return NextResponse.json({ error: "A participant with this email already exists" }, { status: 409 });
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

        return NextResponse.json({ success: true, participant: newParticipant });
    } catch (error: unknown) {
        console.error("Failed to create participant:", error);
        return NextResponse.json({ error: "Failed to create participant" }, { status: 500 });
    }
}
