import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { beginRenewalForUser, RenewalError } from "@/lib/membership/renewal";

export const dynamic = "force-dynamic";

// POST /api/membership/renew — member confirms renewal; advances PENDING_RENEWAL.
export const POST = withAuth({}, async (_req, auth) => {
    if (auth.type !== "session") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const process = await beginRenewalForUser(auth.user.id);
        return NextResponse.json({ process });
    } catch (error) {
        if (error instanceof RenewalError) {
            return NextResponse.json({ error: error.message, code: error.code }, { status: error.code === "not_found" ? 404 : 409 });
        }
        console.error("Renewal begin error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
});
