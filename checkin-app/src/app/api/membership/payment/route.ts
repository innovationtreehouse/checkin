import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/auth";
import { ensurePaymentLinkForUser, PaymentError } from "@/lib/membership/payment";

export const dynamic = "force-dynamic";

// GET /api/membership/payment — the caller's dues amount + Shopify checkout link.
export const GET = withAuth({}, async (_req, auth) => {
    if (auth.type !== "session") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        return NextResponse.json(await ensurePaymentLinkForUser(auth.user.id));
    } catch (error) {
        if (error instanceof PaymentError) {
            return NextResponse.json({ error: error.message, code: error.code }, { status: error.code === "not_found" ? 404 : 409 });
        }
        logger.error("Payment link error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
});
