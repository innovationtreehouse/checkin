import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { saveIntake, IntakeError } from "@/lib/membership/intake";

export const dynamic = "force-dynamic";

const STATUS_FOR: Record<IntakeError["code"], number> = {
    no_household: 400,
    not_lead: 403,
    already_member: 409,
    no_process: 400,
    incomplete: 400,
    lead_limit: 400,
};

// PATCH /api/membership/intake — save (partial) intake form data. Resumable.
export const PATCH = withAuth({}, async (req, auth) => {
    if (auth.type !== "session") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const body = await req.json();
        const state = await saveIntake(auth.user.id, body);
        return NextResponse.json({ state });
    } catch (error) {
        if (error instanceof IntakeError) {
            return NextResponse.json({ error: error.message, code: error.code }, { status: STATUS_FOR[error.code] });
        }
        console.error("Membership intake save error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
});
