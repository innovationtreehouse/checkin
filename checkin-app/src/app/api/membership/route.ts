import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { getIntakeState, startIntake } from "@/lib/membership/intake";
import { intakeErrorResponse } from "@/lib/membership/intakeResponse";

export const dynamic = "force-dynamic";

const handleError = (error: unknown) => intakeErrorResponse(error, "Membership route error");

// GET /api/membership — the caller's current application state, prefilled.
export const GET = withAuth({}, async (_req, auth) => {
    if (auth.type !== "session") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        return NextResponse.json(await getIntakeState(auth.user.id));
    } catch (error) {
        return handleError(error);
    }
});

// POST /api/membership — begin (or resume) an application.
export const POST = withAuth({}, async (_req, auth) => {
    if (auth.type !== "session") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const process = await startIntake(auth.user.id);
        const state = await getIntakeState(auth.user.id);
        return NextResponse.json({ process, state }, { status: 201 });
    } catch (error) {
        return handleError(error);
    }
});
