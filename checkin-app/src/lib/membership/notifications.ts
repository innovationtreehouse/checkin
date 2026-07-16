import prisma from "@/lib/prisma";
import { canReviewBackgroundChecks, eligibleReviewProcessIds } from "@/lib/membership/review";

export interface MembershipNotifications {
    /** Applications this background-check reviewer may currently attest. */
    pendingReviews: number;
    /** Applications stuck at BLOCKED (board/isSysadmin). */
    blocked: number;
}

/**
 * Role-relevant membership counts for the in-app red-dot indicators. One domain's
 * contribution to GET /api/notifications — kept here so the membership rules live
 * with the rest of the membership code, not in the shared notifications route.
 */
export async function getMembershipNotifications(user: {
    id: number;
    isBackgroundCheckReviewer?: boolean;
    isSysadmin?: boolean;
    isBoardMember?: boolean;
}): Promise<MembershipNotifications> {
    const pendingReviews = canReviewBackgroundChecks(user) ? (await eligibleReviewProcessIds(user.id)).length : 0;
    const blocked =
        user.isSysadmin || user.isBoardMember
            ? await prisma.orgMembershipProcess.count({ where: { status: "BLOCKED" } })
            : 0;
    return { pendingReviews, blocked };
}
