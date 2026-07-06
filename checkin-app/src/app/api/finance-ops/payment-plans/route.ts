import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { handler } from "@/security/handler";
import { apiError } from "@/lib/api-response";
import { hasHouseholdConflict } from "@/lib/conflictOfInterest";

export const GET = handler('GET /api/finance-ops/payment-plans', async () => {
    const requests = await prisma.programParticipant.findMany({
        where: {
            isPaymentPlanRequested: true,
            status: 'PENDING'
        },
        include: {
            person: true,
            program: true
        },
        orderBy: {
            pendingSince: 'asc'
        }
    });

    return { ProgramParticipant: requests };
});

export const POST = withAuth(
    { roles: ['isSysadmin', 'isBoardMember'] },
    async (req, auth) => {
        try {
            const body = await req.json();
            const programId = parseInt(body.programId, 10);
            const participantId = parseInt(body.participantId, 10);

            if (Number.isNaN(programId) || Number.isNaN(participantId)) {
                return apiError("programId and participantId are required", 400);
            }

            // Conflict of interest: a board member may not approve their OWN household's
            // program payment plan (activate an enrollment without payment for their own
            // family). Sysadmin bypasses.
            if (auth.type === 'session') {
                const target = await prisma.person.findUnique({ where: { id: participantId }, select: { householdId: true } });
                if (await hasHouseholdConflict(prisma, auth.user.id, target?.householdId, { isSysadmin: auth.user.isSysadmin === true })) {
                    return apiError("You cannot approve your own household's payment plan — a sysadmin must.", 403);
                }
            }

            const data = {
                status: 'ACTIVE' as const,
                isPaymentPlanRequested: false, // cleared since it's approved
                pendingSince: null // reset
            };

            // Scope to the pending request so approving a non-pending/nonexistent
            // request is a no-op error, mirroring the GET queue's filter.
            const { count } = await prisma.programParticipant.updateMany({
                where: { programId, personId: participantId, isPaymentPlanRequested: true, status: 'PENDING' },
                data
            });

            if (count === 0) {
                return apiError("No pending payment-plan request", 409);
            }

            if (auth.type === 'session') {
                await prisma.auditLog.create({
                    data: {
                        actorId: auth.user.id,
                        action: "EDIT",
                        tableName: "ProgramParticipant",
                        affectedEntityId: participantId,
                        secondaryAffectedEntity: programId,
                        newData: data
                    }
                });
            }

            return NextResponse.json({ success: true });
        } catch (error) {
            logger.error("Failed to approve payment plan:", error);
            return apiError("Failed to approve payment plan", 500);
        }
    }
);
