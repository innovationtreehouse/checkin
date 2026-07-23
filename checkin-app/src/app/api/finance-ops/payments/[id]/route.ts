import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";

/**
 * PATCH /api/finance-ops/payments/[id] — the board acknowledges or resolves one
 * reconciler-detected payment problem.
 *   acknowledge → status ACKNOWLEDGED (seen, not yet cleared).
 *   resolve     → status RESOLVED, stamped with who/when + a note.
 * Only a real session may act (mirrors the payment-plans route); every change is
 * audit-logged since the actor is not the affected household.
 */
export const PATCH = withAuth<{ params: Promise<{ id: string }> }>(
    { roles: ['isBoardMember'] },
    async (request: NextRequest, auth, { params }) => {
        if (auth.type !== 'session') {
            return apiError("Unauthorized", 401);
        }

        try {
            const { id: idParam } = await params;
            const id = parseInt(idParam, 10);
            if (Number.isNaN(id)) {
                return apiError("Invalid exception ID", 400);
            }

            const body = await request.json();
            const action = body.action;
            if (action !== 'acknowledge' && action !== 'resolve') {
                return apiError("action must be 'acknowledge' or 'resolve'", 400);
            }

            const data =
                action === 'acknowledge'
                    ? { status: 'ACKNOWLEDGED' as const }
                    : {
                          status: 'RESOLVED' as const,
                          resolvedById: auth.user.id,
                          resolvedAt: new Date(),
                          resolutionNote: typeof body.note === 'string' ? body.note : null,
                      };

            const { count } = await prisma.paymentException.updateMany({
                // Scope to the still-actionable states so acting twice (or on a
                // resolved row) is a no-op error, not a silent re-write.
                where: { id, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
                data,
            });

            if (count === 0) {
                return apiError("No open payment exception with that ID", 409);
            }

            await prisma.auditLog.create({
                data: {
                    actorId: auth.user.id,
                    action: "EDIT",
                    tableName: "PaymentException",
                    affectedEntityId: id,
                    newData: data,
                },
            });

            return NextResponse.json({ success: true });
        } catch (error) {
            logger.error("Failed to update payment exception:", error);
            return apiError("Failed to update payment exception", 500);
        }
    }
);
