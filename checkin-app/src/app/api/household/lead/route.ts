import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { addHouseholdLead, removeHouseholdLead, HouseholdLeadLimitError } from "@/lib/household/leads";
import { apiError } from "@/lib/api-response";

export const POST = withAuth(
    {},
    async (req, auth) => {
        try {
            if (auth.type !== 'session') return apiError("Unauthorized", 401);
            const userId = auth.user.id;

            const body = await req.json();
            const { participantId } = body;

            if (!participantId) {
                return apiError("Participant ID is required", 400);
            }

            const user = await prisma.person.findUnique({
                where: { id: userId },
                select: { isSysadmin: true, isBoardMember: true, isHouseholdLead: true, householdId: true }
            });

            const targetMember = await prisma.person.findUnique({ where: { id: participantId } });
            if (!targetMember) {
                return apiError("Participant not found", 404);
            }
            const targetHouseholdId = targetMember.householdId;

            // Board members and sysadmins can set a lead on ANY household (e.g. fixing
            // a leadless household imported without a primary contact). A regular
            // household lead can only promote within their own household.
            const isPrivileged = !!user?.isSysadmin || !!user?.isBoardMember;
            const isLeadOfTarget = !!user?.isHouseholdLead && user.householdId === targetHouseholdId;
            if (!isPrivileged && !isLeadOfTarget) {
                return apiError("Only household leads, board members, or sysadmins can promote members", 403);
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
                    tableName: "Person",
                    affectedEntityId: targetHouseholdId,
                    secondaryAffectedEntity: participantId,
                    newData: { ...newLead, isHouseholdLead: true }
                }
            });

            return NextResponse.json({ lead: newLead, message: "Member promoted to lead successfully." }, { status: 200 });

        } catch (error: unknown) {
            if (error instanceof HouseholdLeadLimitError) {
                return apiError(error.message, 400);
            }
            logger.error("Household Lead POST Error:", error);
            return apiError("Internal Server Error", 500);
        }
    }
);

export const DELETE = withAuth(
    {},
    async (req, auth) => {
        try {
            if (auth.type !== 'session') return apiError("Unauthorized", 401);
            const userId = auth.user.id;

            const body = await req.json();
            const { participantId } = body;

            if (!participantId) {
                return apiError("Participant ID is required", 400);
            }

            const user = await prisma.person.findUnique({
                where: { id: userId },
                select: { isSysadmin: true, isBoardMember: true, isHouseholdLead: true, householdId: true }
            });

            const targetMember = await prisma.person.findUnique({
                where: { id: participantId },
                select: { householdId: true, isHouseholdLead: true }
            });
            if (!targetMember) {
                return apiError("Participant not found", 404);
            }
            const targetHouseholdId = targetMember.householdId;
            if (!targetHouseholdId) {
                return apiError("Member has no household", 400);
            }

            // Board members and sysadmins can remove a lead from ANY household — the
            // mirror of the promote path in POST. A regular household lead can only
            // remove leads within their own household.
            const isPrivileged = !!user?.isSysadmin || !!user?.isBoardMember;
            const isLeadOfTarget = !!user?.isHouseholdLead && user.householdId === targetHouseholdId;
            if (!isPrivileged && !isLeadOfTarget) {
                return apiError("Only household leads, board members, or sysadmins can remove leads", 403);
            }

            // Locked demote: refuses to drop the household's last lead, and
            // serializes concurrent demotes so two can't both pass the guard and
            // zero-lead the household (see removeHouseholdLead).
            const result = await removeHouseholdLead(prisma, targetHouseholdId, participantId);
            if (!result.removed) {
                if (result.reason === "last_lead") {
                    return apiError("Cannot remove the last lead of a household.", 400);
                }
                return apiError("Member is not a lead", 400);
            }

            await prisma.auditLog.create({
                data: {
                    actorId: userId,
                    action: "DELETE",
                    tableName: "Person",
                    affectedEntityId: targetHouseholdId,
                    secondaryAffectedEntity: participantId,
                    oldData: { householdId: targetHouseholdId, personId: participantId, isHouseholdLead: true }
                }
            });

            return NextResponse.json({ message: "Lead removed successfully." }, { status: 200 });

        } catch (error: unknown) {
            logger.error("Household Lead DELETE Error:", error);
            return apiError("Internal Server Error", 500);
        }
    }
);
