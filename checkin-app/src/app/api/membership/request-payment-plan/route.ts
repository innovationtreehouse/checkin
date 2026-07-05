import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { apiError } from "@/lib/api-response";

export const POST = withAuth({}, async (req, auth) => {
    if (auth.type !== 'session') return apiError("Unauthorized", 401);

    try {
        const body = await req.json();
        const processId = parseInt(body.processId, 10);
        if (Number.isNaN(processId)) {
            return apiError("processId is required", 400);
        }

        const process = await prisma.orgMembershipProcess.findUnique({
            where: { id: processId },
            include: { orgMembership: { include: { household: { include: { leads: true } } } } },
        });

        if (!process) {
            return apiError("Membership application not found", 404);
        }

        // Authorization: only a sysadmin/board member or a lead of this process's
        // household may request a payment plan. Without this gate any authenticated
        // user could flip isPaymentPlanRequested on an arbitrary application (IDOR).
        const currentUserId = auth.user.id;
        const isSysAdminOrBoard = auth.user.isSysadmin || auth.user.isBoardMember;
        const isHouseholdLead = process.orgMembership.household.leads.some((l) => l.personId === currentUserId);

        if (!isSysAdminOrBoard && !isHouseholdLead) {
            return apiError("Forbidden: Not authorized to request a payment plan for this membership", 403);
        }

        if (process.status !== 'PENDING_PAYMENT') {
            return apiError("This application is not awaiting payment", 409);
        }

        const updated = await prisma.orgMembershipProcess.update({
            where: { id: processId },
            data: { isPaymentPlanRequested: true },
        });

        // Alert the finance committee. In a real implementation this would trigger an
        // actual email via SendGrid, NodeMailer, etc.
        logger.info(`[EMAIL DISPATCH] To: finance@innovationtreehouse.org, Subject: Membership Payment Plan Request for household ${process.orgMembership.householdId}`);

        return NextResponse.json({ success: true, process: updated });
    } catch (error) {
        logger.error("Membership payment plan request error:", error);
        return apiError("Failed to request payment plan", 500);
    }
});
