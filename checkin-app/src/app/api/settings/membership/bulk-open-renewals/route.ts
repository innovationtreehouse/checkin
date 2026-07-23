import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { openRenewalsForAllActive } from "@/lib/membership/renewal";
import { apiError } from "@/lib/api-response";

export const dynamic = "force-dynamic";

/**
 * POST /api/settings/membership/bulk-open-renewals — go-live action.
 * Opens a renewal cycle (PENDING_RENEWAL) for every active membership not already
 * mid-renewal. Board members or sysadmins may trigger it; it is a deliberate,
 * manual one-time action (nothing opens automatically). Never emails — this button
 * only opens processes; the settings/outreach page is the only send surface.
 */
export const POST = withAuth({ roles: ["isSysadmin", "isBoardMember"] }, async (_req, auth) => {
    if (auth.type !== "session") return apiError("Unauthorized", 401);
    const result = await openRenewalsForAllActive();
    return NextResponse.json({ success: true, ...result });
});
