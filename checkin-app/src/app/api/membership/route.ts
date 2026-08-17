import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { getIntakeState, startIntake } from "@/lib/membership/intake";
import { intakeErrorResponse } from "@/lib/membership/intakeResponse";
import { apiError } from "@/lib/api-response";

export const dynamic = "force-dynamic";

const handleError = (error: unknown) => intakeErrorResponse(error, "Membership route error");

// GET /api/membership — the caller's current application state, prefilled.
export const GET = withAuth({}, async (_req, auth) => {
    if (auth.type !== "session") return apiError("Unauthorized", 401);
    try {
        return NextResponse.json(await getIntakeState(auth.user.id));
    } catch (error) {
        return handleError(error);
    }
});

// POST /api/membership — begin (or resume) an application. Returns the same
// state shape as GET — deliberately NOT the raw OrgMembershipProcess row from
// startIntake: on resume that row carries internal-tier fields (zoho
// envelope/action ids, shopify ids, stage timestamps) no household caller
// needs; state.process is the {id, kind, status} the UI reads.
export const POST = withAuth({}, async (_req, auth) => {
    if (auth.type !== "session") return apiError("Unauthorized", 401);
    try {
        await startIntake(auth.user.id);
        const state = await getIntakeState(auth.user.id);
        return NextResponse.json({ state }, { status: 201 });
    } catch (error) {
        return handleError(error);
    }
});
