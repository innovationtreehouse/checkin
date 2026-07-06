import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { handler } from "@/security/handler";
import { apiError } from "@/lib/api-response";
import { isActiveOrgMember, ACTIVE_ORG_MEMBER_INCLUDE } from "@/lib/orgMembership";
import { hasHouseholdConflict } from "@/lib/conflictOfInterest";
import { adjustProgramInventory } from "@/lib/shopify";

export const GET = handler('GET /api/finance-ops/payment-plans', async () => {
    const [requests, boardSettings] = await Promise.all([
        prisma.programParticipant.findMany({
            where: {
                isPaymentPlanRequested: true,
                status: 'PENDING'
            },
            include: {
                // Nests household->orgMembership (same shape as ACTIVE_ORG_MEMBER_INCLUDE)
                // so the board can see CURRENT membership while a request is still
                // pending — wasOrgMemberAtApproval is null until approved, so it can't
                // answer this. Derive live client-side; nothing new to stamp/store here.
                person: { include: ACTIVE_ORG_MEMBER_INCLUDE },
                program: true // carries startAt (public) — half of the next-year flag
            },
            orderBy: {
                pendingSince: 'asc'
            }
        }),
        // The membership-year cutoff. Shipped so the board can flag requests whose
        // program lands in the NEXT membership year (program.startAt >= next cutoff).
        // Derived on the client, not stamped: the security stripper drops ad-hoc
        // booleans, so we ship the two classified inputs (startAt + this boundary)
        // and compare client-side — same pattern as the Member/Non-member column.
        prisma.boardSettings.findUnique({ where: { id: 1 } })
    ]);

    return { ProgramParticipant: requests, BoardSettings: boardSettings };
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

            // Point-in-time snapshot: membership status changes over time, so this
            // must be stamped now, at approval — not derived later from the live
            // OrgMembership row. Reuses the canonical org-member check (lib/orgMembership.ts).
            const wasOrgMemberAtApproval = await isActiveOrgMember(participantId);

            const data = {
                status: 'ACTIVE' as const,
                isPaymentPlanRequested: false, // cleared since it's approved
                pendingSince: null, // reset
                wasOrgMemberAtApproval
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

            // Scholarship lifecycle drives inventory (product decision 2026-07-06):
            // the seat was already decremented from Shopify at APPLICATION time
            // (POST .../request-payment-plan), so approval performs NO Shopify
            // operation — the applicant already holds the seat; approval just
            // stops billing them for it. This supersedes the earlier approve-time
            // decrement (see PR history — that double-counted against the
            // apply-time decrement added alongside it).
            return NextResponse.json({ success: true });
        } catch (error) {
            logger.error("Failed to approve payment plan:", error);
            return apiError("Failed to approve payment plan", 500);
        }
    }
);
