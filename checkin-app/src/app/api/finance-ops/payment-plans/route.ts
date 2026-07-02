import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { handler } from "@/security/handler";

export const GET = handler('GET /api/finance-ops/payment-plans', async () => {
    const requests = await prisma.programParticipant.findMany({
        where: {
            isPaymentPlanRequested: true,
            status: 'PENDING'
        },
        include: {
            participant: true,
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
                return NextResponse.json({ error: "programId and participantId are required" }, { status: 400 });
            }

            const data = {
                status: 'ACTIVE' as const,
                isPaymentPlanRequested: false, // cleared since it's approved
                pendingSince: null // reset
            };

            // Scope to the pending request so approving a non-pending/nonexistent
            // request is a no-op error, mirroring the GET queue's filter.
            const { count } = await prisma.programParticipant.updateMany({
                where: { programId, participantId, isPaymentPlanRequested: true, status: 'PENDING' },
                data
            });

            if (count === 0) {
                return NextResponse.json({ error: "No pending payment-plan request" }, { status: 409 });
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
            console.error("Failed to approve payment plan:", error);
            return NextResponse.json({ error: "Failed to approve payment plan" }, { status: 500 });
        }
    }
);
