import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { getConfigHealth } from "@/lib/configHealth";

export const dynamic = "force-dynamic";

/**
 * GET /api/system-status/config-health — the full per-check config-health list for the
 * System Status page. Admins + board only; returns booleans + human detail, never secret
 * values. The nav badge reads only the failing-count from /api/nav/todo-counts; this is
 * the detail view. See lib/configHealth.ts.
 */
export const GET = withAuth({}, async (_req, auth) => {
    if (auth.type !== "session") return apiError("Unauthorized", 401);
    if (!(auth.user.isSysadmin || auth.user.isBoardMember)) return apiError("Forbidden", 403);
    return NextResponse.json({ checks: getConfigHealth() });
});
