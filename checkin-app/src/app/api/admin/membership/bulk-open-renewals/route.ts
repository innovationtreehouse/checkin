import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { openRenewalsForAllActive } from "@/lib/membership/renewal";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/membership/bulk-open-renewals — go-live action.
 * Opens a renewal cycle (PENDING_RENEWAL) for every active membership not already
 * mid-renewal. Board members or sysadmins may trigger it; it is a deliberate,
 * manual one-time action (nothing opens automatically).
 * Body: { sendReminders?: boolean } (default false — avoids a mass email blast).
 */
export const POST = withAuth({ roles: ["sysadmin", "boardMember"] }, async (req, auth) => {
    if (auth.type !== "session") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    let body: { sendReminders?: boolean } = {};
    try {
        body = await req.json();
    } catch {
        /* empty body is fine */
    }
    const result = await openRenewalsForAllActive(new Date(), { sendReminders: !!body.sendReminders });
    return NextResponse.json({ success: true, ...result });
});
