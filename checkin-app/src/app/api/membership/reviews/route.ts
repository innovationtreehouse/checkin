import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { handler, unauthorized } from "@/security/handler";
import { eligibleReviewProcessIds, attest, ReviewError } from "@/lib/membership/review";

export const dynamic = "force-dynamic";

const STATUS_FOR: Record<ReviewError["code"], number> = {
    not_reviewer: 403,
    not_found: 404,
    wrong_phase: 409,
    same_household_applicant: 403,
    same_household_reviewer: 403,
    already_attested: 409,
};

/**
 * GET /api/membership/reviews — applications this reviewer may attest.
 *
 * Eligibility is computed in the service; the result is returned as model rows
 * so the security stripper governs field visibility (registry grants reviewers
 * pii + public only — applicant parents' names/emails, nothing internal). The
 * attestation _count doubles as the approval count for queue rows.
 *
 * The query selects ONLY the household leads' (parents') participant rows — the
 * reviewer never needs the children, so their PII never leaves the DB. The
 * stripper is defense-in-depth on top of this narrowing, not the primary filter.
 */
export const GET = handler("GET /api/membership/reviews", async ({ auth }) => {
    if (auth.type !== "session") throw unauthorized();
    const ids = await eligibleReviewProcessIds(auth.user.id);
    const queue = await prisma.membershipProcess.findMany({
        where: { id: { in: ids } },
        orderBy: { stageEnteredAt: "asc" },
        select: {
            id: true,
            membership: {
                select: {
                    household: {
                        select: {
                            name: true,
                            leads: { select: { participant: { select: { id: true, name: true, email: true } } } },
                        },
                    },
                },
            },
            _count: { select: { attestations: true } },
        },
    });
    return { MembershipProcess: queue };
});

// POST /api/membership/reviews — submit an attestation { processId, result, isMarkedVolunteer }.
// Board members are implicit reviewers (see canReviewBackgroundChecks); attest() re-checks.
export const POST = withAuth({ roles: ["isBackgroundCheckReviewer", "isBoardMember"] }, async (req, auth) => {
    if (auth.type !== "session") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    let body: { processId?: number; result?: "APPROVE" | "REJECT"; isMarkedVolunteer?: boolean };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (!body.processId || (body.result !== "APPROVE" && body.result !== "REJECT")) {
        return NextResponse.json({ error: "processId and result (APPROVE|REJECT) are required" }, { status: 400 });
    }
    try {
        const outcome = await attest(auth.user.id, body.processId, { result: body.result, isMarkedVolunteer: body.isMarkedVolunteer });
        return NextResponse.json({ outcome });
    } catch (error) {
        if (error instanceof ReviewError) {
            return NextResponse.json({ error: error.message, code: error.code }, { status: STATUS_FOR[error.code] });
        }
        console.error("Attestation error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
});
