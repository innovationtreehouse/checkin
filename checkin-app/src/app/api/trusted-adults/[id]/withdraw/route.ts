import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/auth";
import { withdrawTrustedAdult, TrustedAdultError } from "@/lib/trusted-adult/service";
import { apiError } from "@/lib/api-response";

export const dynamic = "force-dynamic";

const STATUS_FOR: Record<TrustedAdultError["code"], number> = {
    not_found: 404,
    bad_input: 400,
    wrong_phase: 409,
    forbidden: 403,
    already_open: 409,
};

/**
 * POST /api/trusted-adults/[id]/withdraw — subject (or their household lead)
 * withdraws a disclosed relationship; the latest review is marked REVOKED.
 */
export const POST = withAuth({}, async (req, auth) => {
    if (auth.type !== "session") return apiError("Unauthorized", 401);
    const id = parseInt(req.nextUrl.pathname.split("/").at(-2) ?? "", 10);
    if (isNaN(id)) return apiError("Invalid id", 400);
    try {
        await withdrawTrustedAdult(id, auth.user.id);
        return NextResponse.json({ ok: true });
    } catch (error) {
        if (error instanceof TrustedAdultError) {
            return NextResponse.json({ error: error.message, code: error.code }, { status: STATUS_FOR[error.code] });
        }
        logger.error("Trusted adult withdraw error:", error);
        return apiError("Internal Server Error", 500);
    }
});
