import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/auth";
import { beginRenewalForUser, RenewalError } from "@/lib/membership/renewal";
import { apiError } from "@/lib/api-response";

export const dynamic = "force-dynamic";

// POST /api/membership/renew — member confirms renewal; advances PENDING_RENEWAL.
export const POST = withAuth({}, async (_req, auth) => {
    if (auth.type !== "session") return apiError("Unauthorized", 401);
    try {
        const process = await beginRenewalForUser(auth.user.id);
        return NextResponse.json({ process });
    } catch (error) {
        if (error instanceof RenewalError) {
            return NextResponse.json({ error: error.message, code: error.code }, { status: error.code === "not_found" ? 404 : 409 });
        }
        logger.error("Renewal begin error:", error);
        return apiError("Internal Server Error", 500);
    }
});
