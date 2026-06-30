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
    async (req) => {
        try {
            const body = await req.json();
            const { programId, participantId } = body;

            const updated = await prisma.programParticipant.update({
                where: {
                    programId_participantId: {
                        programId: parseInt(programId, 10),
                        participantId: parseInt(participantId, 10)
                    }
                },
                data: {
                    status: 'ACTIVE',
                    isPaymentPlanRequested: false, // cleared since it's approved
                    pendingSince: null // reset
                }
            });

            return NextResponse.json({ success: true, participant: updated });
        } catch (error) {
            console.error("Failed to approve payment plan:", error);
            return NextResponse.json({ error: "Failed to approve payment plan" }, { status: 500 });
        }
    }
);
