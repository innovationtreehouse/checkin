import prisma from "@/lib/prisma";
import { eligibleReviewProcessIds } from "@/lib/membership/review";

export interface MembershipNotifications {
    /** Applications this background-check reviewer may currently attest. */
    pendingReviews: number;
    /** Applications stuck at BLOCKED (board/sysadmin). */
    blocked: number;
}

/**
 * Role-relevant membership counts for the in-app red-dot indicators. One domain's
 * contribution to GET /api/notifications — kept here so the membership rules live
 * with the rest of the membership code, not in the shared notifications route.
 */
export async function getMembershipNotifications(user: {
    id: number;
    backgroundCheckReviewer?: boolean;
    sysadmin?: boolean;
    boardMember?: boolean;
}): Promise<MembershipNotifications> {
    const pendingReviews = user.backgroundCheckReviewer ? (await eligibleReviewProcessIds(user.id)).length : 0;
    const blocked =
        user.sysadmin || user.boardMember
            ? await prisma.membershipProcess.count({ where: { status: "BLOCKED" } })
            : 0;
    return { pendingReviews, blocked };
}
