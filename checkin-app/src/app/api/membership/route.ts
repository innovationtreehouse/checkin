import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { getIntakeState, startIntake, IntakeError } from "@/lib/membership/intake";

export const dynamic = "force-dynamic";

const STATUS_FOR: Record<IntakeError["code"], number> = {
    no_household: 400,
    not_lead: 403,
    already_member: 409,
    no_process: 400,
    incomplete: 400,
    lead_limit: 400,
};

function handleError(error: unknown) {
    if (error instanceof IntakeError) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: STATUS_FOR[error.code] });
    }
    console.error("Membership route error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
}

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
