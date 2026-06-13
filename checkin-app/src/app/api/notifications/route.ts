import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { getMembershipNotifications } from "@/lib/membership/notifications";

export const dynamic = "force-dynamic";

/**
 * GET /api/notifications — aggregated, role-relevant in-app notification counts for
 * the current user, namespaced by domain so new sources (events, shop, …) can be
 * added as sibling keys without changing the response shape or the client contract.
 *   { membership: { pendingReviews, blocked } }
 */
export const GET = withAuth({}, async (_req, auth) => {
    if (auth.type !== "session") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const membership = await getMembershipNotifications(auth.user);

    return NextResponse.json({ membership });
});
