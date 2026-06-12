import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { decideReview, SafetyLinkError } from "@/lib/safety-link/service";

export const dynamic = "force-dynamic";

const STATUS_FOR: Record<SafetyLinkError["code"], number> = {
    not_found: 404,
    bad_input: 400,
    wrong_phase: 409,
    forbidden: 403,
    already_open: 409,
};

const DECISIONS = new Set(["APPROVE", "APPROVE_WITH_CONDITIONS", "DENY", "REQUEST_INFO"]);

/**
 * POST /api/admin/safety-links/decision — a board member decides a review.
 * Body: { reviewId, decision, conditions?, note? }. Single entry, no quorum.
 */
export const POST = withAuth({ roles: ["boardMember", "sysadmin"] }, async (req, auth) => {
    if (auth.type !== "session") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    let body: { reviewId?: number; decision?: string; conditions?: string; note?: string };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (!body.reviewId || !body.decision || !DECISIONS.has(body.decision)) {
        return NextResponse.json({ error: "reviewId and a valid decision are required" }, { status: 400 });
    }
    try {
        const outcome = await decideReview(body.reviewId, auth.user.id, {
            decision: body.decision as "APPROVE" | "APPROVE_WITH_CONDITIONS" | "DENY" | "REQUEST_INFO",
            conditions: body.conditions,
            note: body.note,
        });
        return NextResponse.json({ status: outcome.status });
    } catch (error) {
        if (error instanceof SafetyLinkError) {
            return NextResponse.json({ error: error.message, code: error.code }, { status: STATUS_FOR[error.code] });
        }
        console.error("Safety link decision error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
});
