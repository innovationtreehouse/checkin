import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { decideReview, TrustedAdultError } from "@/lib/trusted-adult/service";

export const dynamic = "force-dynamic";

const STATUS_FOR: Record<TrustedAdultError["code"], number> = {
    not_found: 404,
    bad_input: 400,
    wrong_phase: 409,
    forbidden: 403,
    already_open: 409,
};

const DECISIONS = new Set(["APPROVE", "DENY", "REQUEST_INFO"]);

/**
 * POST /api/safety/trusted-adults/decision — a board member decides a review.
 * Body: { reviewId, decision, sharedNote?, note? }. APPROVE requires sharedNote
 * (the outward note keyholders & program leads see). Single entry, no quorum.
 */
export const POST = withAuth({ roles: ["isBoardMember", "isSysadmin"] }, async (req, auth) => {
    if (auth.type !== "session") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    let body: { reviewId?: number; decision?: string; sharedNote?: string; note?: string };
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
            decision: body.decision as "APPROVE" | "DENY" | "REQUEST_INFO",
            sharedNote: body.sharedNote,
            note: body.note,
        });
        return NextResponse.json({ status: outcome.status });
    } catch (error) {
        if (error instanceof TrustedAdultError) {
            return NextResponse.json({ error: error.message, code: error.code }, { status: STATUS_FOR[error.code] });
        }
        console.error("Trusted adult decision error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
});
