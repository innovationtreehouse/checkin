import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";

export const POST = withAuth(
    {},
    async (req, auth) => {
        try {
            if (auth.type !== 'session') return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
            const userId = auth.user.id;

            const body = await req.json();
            const { participantId } = body;

            if (!participantId) {
                return NextResponse.json({ error: "Participant ID is required" }, { status: 400 });
            }

            const user = await prisma.participant.findUnique({
                where: { id: userId },
                include: { householdLeads: true }
            });

            if (!user?.householdId) {
                return NextResponse.json({ error: "You must create a household first" }, { status: 400 });
            }

            const isLead = user.householdLeads.some(lead => lead.householdId === user.householdId);
            if (!isLead && !user.sysadmin) {
                return NextResponse.json({ error: "Only household leads or sysadmins can promote members" }, { status: 403 });
            }

            const targetMember = await prisma.participant.findUnique({ where: { id: participantId } });
            if (!targetMember || targetMember.householdId !== user.householdId) {
                return NextResponse.json({ error: "Member not found in your household" }, { status: 404 });
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
                 return NextResponse.json({ message: "Member is already a lead" }, { status: 200 });
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

            return NextResponse.json({ lead: newLead, message: "Member promoted to lead successfully." }, { status: 200 });

        } catch (error: unknown) {
            console.error("Household Lead POST Error:", error);
            return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
        }
    }
);

export const DELETE = withAuth(
    {},
    async (req, auth) => {
        try {
            if (auth.type !== 'session') return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
            const userId = auth.user.id;

            const body = await req.json();
            const { participantId } = body;

            if (!participantId) {
                return NextResponse.json({ error: "Participant ID is required" }, { status: 400 });
            }

            const user = await prisma.participant.findUnique({
                where: { id: userId },
                include: { householdLeads: true }
            });

            if (!user?.householdId) {
                 return NextResponse.json({ error: "You must create a household first" }, { status: 400 });
            }

            const isLead = user.householdLeads.some(lead => lead.householdId === user.householdId);
            if (!isLead && !user.sysadmin) {
                return NextResponse.json({ error: "Only household leads or sysadmins can remove leads" }, { status: 403 });
            }

            const targetMember = await prisma.participant.findUnique({ where: { id: participantId } });
            if (!targetMember || targetMember.householdId !== user.householdId) {
                return NextResponse.json({ error: "Member not found in your household" }, { status: 404 });
            }

            const allLeads = await prisma.householdLead.findMany({
                where: { householdId: user.householdId }
            });

            if (allLeads.length <= 1 && allLeads.some(l => l.participantId === participantId)) {
                return NextResponse.json({ error: "Cannot remove the last lead of a household." }, { status: 400 });
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
                 return NextResponse.json({ error: "Member is not a lead" }, { status: 400 });
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

            return NextResponse.json({ message: "Lead removed successfully." }, { status: 200 });

        } catch (error: unknown) {
            console.error("Household Lead DELETE Error:", error);
            return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
        }
    }
);
