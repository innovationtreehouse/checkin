import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { submitIntake, getIntakeState } from "@/lib/membership/intake";
import { intakeErrorResponse } from "@/lib/membership/intakeResponse";

export const dynamic = "force-dynamic";

// POST /api/membership/intake/submit — validate + advance INTAKE -> EXTERNAL.
export const POST = withAuth({}, async (_req, auth) => {
    if (auth.type !== "session") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        await submitIntake(auth.user.id);
        const state = await getIntakeState(auth.user.id);
        return NextResponse.json({ state });
    } catch (error) {
        return intakeErrorResponse(error, "Membership intake submit error");
    }
});
