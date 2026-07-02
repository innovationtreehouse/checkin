import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { logBackendError, logger } from "@/lib/logger";
import { apiError } from "@/lib/api-response";

export const POST = withAuth<{ params: Promise<{ id: string }> }>(
    { roles: ['isSysadmin', 'isBoardMember'] },
    async (req: NextRequest, auth, { params }) => {
    try {
        const { id } = await params;
        if (auth.type !== 'session') {
            return apiError("Unauthorized", 401);
        }

        const participantId = parseInt(id);
        if (isNaN(participantId)) {
            logger.error(`Invalid participant ID from params: ${id}`);
            return apiError(`Invalid participant ID: ${id}`, 400);
        }

        const { householdId, createNew } = await req.json();

        if (!householdId && !createNew) {
            return apiError("Must provide either householdId or createNew boolean", 400);
        }

        const participant = await prisma.person.findUnique({ where: { id: participantId } });
        if (!participant) {
            return apiError("Participant not found", 404);
        }

        let targetHouseholdId: number;

        if (createNew) {
            const newHousehold = await prisma.household.create({
                data: {
                    name: `${participant.name || 'User'}'s Household`,
                    leads: {
                        create: {
                            personId: participant.id
                        }
                    }
                }
            });
            targetHouseholdId = newHousehold.id;
            // New household starts as a visitor (no membership) — membership is
            // earned via the application process or set on the households page.
        } else {
            targetHouseholdId = parseInt(householdId);
            if (isNaN(targetHouseholdId)) {
                return apiError("Invalid household ID", 400);
            }

            const household = await prisma.household.findUnique({ where: { id: targetHouseholdId } });
            if (!household) {
                return apiError("Household not found", 404);
            }
        }

        const updatedParticipant = await prisma.person.update({
            where: { id: participantId },
            data: { householdId: targetHouseholdId },
            include: { household: true }
        });

        await prisma.auditLog.create({
            data: {
                actorId: auth.user.id,
                action: "EDIT",
                tableName: "Participant",
                affectedEntityId: participantId,
                oldData: { householdId: participant.householdId },
                newData: { householdId: targetHouseholdId, createNew: Boolean(createNew) },
            },
        });

        if (participant.householdId && participant.householdId !== targetHouseholdId) {
            await prisma.householdLead.deleteMany({
                where: {
                    personId: participant.id,
                    householdId: participant.householdId
                }
            });
        }

        return NextResponse.json({ success: true, participant: updatedParticipant });
    } catch (error) {
        await logBackendError(error, "POST /api/membership-ops/participants/[id]/household");
        return apiError(`Internal server error`, 500);
    }
});
