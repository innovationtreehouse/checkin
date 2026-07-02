import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { addHouseholdLead, HouseholdLeadLimitError } from "@/lib/household/leads";

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

            const targetMember = await prisma.participant.findUnique({ where: { id: participantId } });
            if (!targetMember) {
                return NextResponse.json({ error: "Participant not found" }, { status: 404 });
            }
            const targetHouseholdId = targetMember.householdId;

            // Board members and sysadmins can set a lead on ANY household (e.g. fixing
            // a leadless household imported without a primary contact). A regular
            // household lead can only promote within their own household.
            const isPrivileged = !!user?.isSysadmin || !!user?.isBoardMember;
            const isLeadOfTarget = !!user?.householdLeads.some(lead => lead.householdId === targetHouseholdId);
            if (!isPrivileged && !isLeadOfTarget) {
                return NextResponse.json({ error: "Only household leads, board members, or sysadmins can promote members" }, { status: 403 });
            }

            const { created } = await addHouseholdLead(prisma, targetHouseholdId, participantId);

            if (!created) {
                return NextResponse.json({ message: "Member is already a lead" }, { status: 200 });
            }

            const newLead = { householdId: targetHouseholdId, participantId };
            await prisma.auditLog.create({
                data: {
                    actorId: userId,
                    action: "CREATE",
                    tableName: "HouseholdLead",
                    affectedEntityId: targetHouseholdId,
                    secondaryAffectedEntity: participantId,
                    newData: newLead
                }
            });

            return NextResponse.json({ lead: newLead, message: "Member promoted to lead successfully." }, { status: 200 });

        } catch (error: unknown) {
            if (error instanceof HouseholdLeadLimitError) {
                return NextResponse.json({ error: error.message }, { status: 400 });
            }
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

            const targetMember = await prisma.participant.findUnique({ where: { id: participantId } });
            if (!targetMember) {
                return NextResponse.json({ error: "Participant not found" }, { status: 404 });
            }
            const targetHouseholdId = targetMember.householdId;
            if (!targetHouseholdId) {
                return NextResponse.json({ error: "Member has no household" }, { status: 400 });
            }

            // Board members and sysadmins can remove a lead from ANY household — the
            // mirror of the promote path in POST. A regular household lead can only
            // remove leads within their own household.
            const isPrivileged = !!user?.isSysadmin || !!user?.isBoardMember;
            const isLeadOfTarget = !!user?.householdLeads.some(lead => lead.householdId === targetHouseholdId);
            if (!isPrivileged && !isLeadOfTarget) {
                return NextResponse.json({ error: "Only household leads, board members, or sysadmins can remove leads" }, { status: 403 });
            }

            const allLeads = await prisma.householdLead.findMany({
                where: { householdId: targetHouseholdId }
            });

            if (allLeads.length <= 1 && allLeads.some(l => l.personId === participantId)) {
                return NextResponse.json({ error: "Cannot remove the last lead of a household." }, { status: 400 });
            }

            const existingLead = await prisma.householdLead.findUnique({
                where: {
                    householdId_personId: {
                        householdId: targetHouseholdId,
                        personId: participantId
                    }
                }
            });

            if (!existingLead) {
                 return NextResponse.json({ error: "Member is not a lead" }, { status: 400 });
            }

            await prisma.householdLead.delete({
                where: {
                    householdId_personId: {
                        householdId: targetHouseholdId,
                        personId: participantId
                    }
                }
            });

            await prisma.auditLog.create({
                data: {
                    actorId: userId,
                    action: "DELETE",
                    tableName: "HouseholdLead",
                    affectedEntityId: targetHouseholdId,
                    secondaryAffectedEntity: participantId,
                    oldData: existingLead
                }
            });

            return NextResponse.json({ message: "Lead removed successfully." }, { status: 200 });

        } catch (error: unknown) {
            console.error("Household Lead DELETE Error:", error);
            return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
        }
    }
);
