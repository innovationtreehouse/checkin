import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { getMembershipNotifications } from "@/lib/membership/notifications";
import { getEmergencyContactNotifications } from "@/lib/emergencyContacts/notifications";

export const dynamic = "force-dynamic";

/**
 * GET /api/notifications — aggregated, role-relevant in-app notification counts for
 * the current user, namespaced by domain so new sources (events, shop, …) can be
 * added as sibling keys without changing the response shape or the client contract.
 *   { membership: { pendingReviews, blocked }, emergencyContacts: { householdsMissingValidContact } }
 */
export const GET = withAuth({}, async (_req, auth) => {
    if (auth.type !== "session") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const [membership, emergencyContacts] = await Promise.all([
        getMembershipNotifications(auth.user),
        getEmergencyContactNotifications(auth.user),
    ]);

    return NextResponse.json({ membership, emergencyContacts });
});
