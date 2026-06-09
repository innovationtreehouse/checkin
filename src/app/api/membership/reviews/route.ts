import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { listReviewQueue, attest, ReviewError } from "@/lib/membership/review";

export const dynamic = "force-dynamic";

const STATUS_FOR: Record<ReviewError["code"], number> = {
    not_reviewer: 403,
    not_found: 404,
    wrong_phase: 409,
    same_household_applicant: 403,
    same_household_reviewer: 403,
    already_attested: 409,
};

// GET /api/membership/reviews — applications this reviewer may attest.
export const GET = withAuth({ roles: ["backgroundCheckReviewer"] }, async (_req, auth) => {
    if (auth.type !== "session") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ queue: await listReviewQueue(auth.user.id) });
});

// POST /api/membership/reviews — submit an attestation { processId, result, markedVolunteer }.
export const POST = withAuth({ roles: ["backgroundCheckReviewer"] }, async (req, auth) => {
    if (auth.type !== "session") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    let body: { processId?: number; result?: "APPROVE" | "REJECT"; markedVolunteer?: boolean };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (!body.processId || (body.result !== "APPROVE" && body.result !== "REJECT")) {
        return NextResponse.json({ error: "processId and result (APPROVE|REJECT) are required" }, { status: 400 });
    }
    try {
        const outcome = await attest(auth.user.id, body.processId, { result: body.result, markedVolunteer: body.markedVolunteer });
        return NextResponse.json({ outcome });
    } catch (error) {
        if (error instanceof ReviewError) {
            return NextResponse.json({ error: error.message, code: error.code }, { status: STATUS_FOR[error.code] });
        }
        console.error("Attestation error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
});
