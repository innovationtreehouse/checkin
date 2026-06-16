import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { saveIntake } from "@/lib/membership/intake";
import { intakeErrorResponse } from "@/lib/membership/intakeResponse";

export const dynamic = "force-dynamic";

// PATCH /api/membership/intake — save (partial) intake form data. Resumable.
export const PATCH = withAuth({}, async (req, auth) => {
    if (auth.type !== "session") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const body = await req.json();
        const { state, rejections } = await saveIntake(auth.user.id, body);
        return NextResponse.json({ state, rejections });
    } catch (error) {
        return intakeErrorResponse(error, "Membership intake save error");
    }
});
