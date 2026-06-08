import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { authenticateRequest } from "@/lib/auth";
import { logBackendError } from "@/lib/logger";

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

        // Every participant must belong to a household, so resolve it before
        // creating: parent's household > explicitly provided household > a new
        // household of their own.
        let householdIdToAssign: number | null = null;

        if (parentEmail) {
            let parent = await prisma.participant.findUnique({
                where: { email: parentEmail }
            });

            if (!parent) {
                parent = await prisma.participant.create({
                    data: {
                        email: parentEmail,
                        household: {
                            create: { name: "Household" }
                        }
                    }
                });
                await prisma.householdLead.create({
                    data: { householdId: parent.householdId, participantId: parent.id }
                });
                await prisma.membership.create({
                    data: {
                        householdId: parent.householdId,
                        status: 'ACTIVE',
                    }
                });
            }

            householdIdToAssign = parent.householdId;
        } else if (householdId) {
            householdIdToAssign = householdId;
        }

        let newParticipant;
        if (householdIdToAssign) {
            newParticipant = await prisma.participant.create({
                data: {
                    name,
                    ...(email && { email }),
                    dob: dob ? new Date(dob).toISOString() : null,
                    householdId: householdIdToAssign
                }
            });
        } else {
            const lastName = (name || "").trim().split(/\s+/).pop() || "";
            newParticipant = await prisma.participant.create({
                data: {
                    name,
                    ...(email && { email }),
                    dob: dob ? new Date(dob).toISOString() : null,
                    household: {
                        create: { name: lastName ? `${lastName} Household` : "Household" }
                    }
                }
            });

            await prisma.householdLead.create({
                data: { householdId: newParticipant.householdId, participantId: newParticipant.id }
            });

            await prisma.membership.create({
                data: {
                    householdId: newParticipant.householdId,
                    status: 'ACTIVE',
                }
            });
        }

        return NextResponse.json({ success: true, participant: newParticipant });
    } catch (error: unknown) {
        await logBackendError(error, "POST /api/admin/participants");
        return NextResponse.json({ error: `Failed to create participant` }, { status: 500 });
    }
}
