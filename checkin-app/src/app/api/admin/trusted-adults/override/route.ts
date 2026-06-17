import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { overrideReview, TrustedAdultError } from "@/lib/trusted-adult/service";

export const dynamic = "force-dynamic";

const STATUS_FOR: Record<TrustedAdultError["code"], number> = {
    not_found: 404,
    bad_input: 400,
    wrong_phase: 409,
    forbidden: 403,
    already_open: 409,
};

/**
 * POST /api/admin/trusted-adults/override — board/sysadmin force a review to a
 * terminal state regardless of phase. Body: { reviewId, action: approve|deny|revoke }.
 */
export const POST = withAuth({ roles: ["boardMember", "sysadmin"] }, async (req, auth) => {
    if (auth.type !== "session") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    let body: { reviewId?: number; action?: "approve" | "deny" | "revoke"; sharedNote?: string };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (!body.reviewId || !["approve", "deny", "revoke"].includes(body.action ?? "")) {
        return NextResponse.json({ error: "reviewId and action (approve|deny|revoke) are required" }, { status: 400 });
    }
    try {
        const outcome = await overrideReview(body.reviewId, auth.user.id, body.action!, body.sharedNote);
        return NextResponse.json({ status: outcome.status });
    } catch (error) {
        if (error instanceof TrustedAdultError) {
            return NextResponse.json({ error: error.message, code: error.code }, { status: STATUS_FOR[error.code] });
        }
        console.error("Trusted adult override error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
});
