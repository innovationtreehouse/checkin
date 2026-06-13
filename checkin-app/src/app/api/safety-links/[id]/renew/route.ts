import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { renewSafetyLink, SafetyLinkError } from "@/lib/safety-link/service";

export const dynamic = "force-dynamic";

const STATUS_FOR: Record<SafetyLinkError["code"], number> = {
    not_found: 404,
    bad_input: 400,
    wrong_phase: 409,
    forbidden: 403,
    already_open: 409,
};

/**
 * POST /api/safety-links/[id]/renew — one-click resubmit. No body: reuses every
 * fact on the link and opens a fresh board review. Subject or household lead only.
 */
export const POST = withAuth({}, async (req, auth) => {
    if (auth.type !== "session") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const id = parseInt(req.nextUrl.pathname.split("/").at(-2) ?? "", 10);
    if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    try {
        const review = await renewSafetyLink(id, auth.user.id);
        return NextResponse.json({ reviewId: review.id });
    } catch (error) {
        if (error instanceof SafetyLinkError) {
            return NextResponse.json({ error: error.message, code: error.code }, { status: STATUS_FOR[error.code] });
        }
        console.error("Safety link renew error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
});
