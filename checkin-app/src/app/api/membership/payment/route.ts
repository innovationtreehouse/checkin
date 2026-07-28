import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/auth";
import { ensurePaymentLinkForUser, PaymentError } from "@/lib/membership/payment";
import { apiError } from "@/lib/api-response";

export const dynamic = "force-dynamic";

// GET /api/membership/payment — the caller's dues amount + Shopify checkout link.
export const GET = withAuth({}, async (_req, auth) => {
    if (auth.type !== "session") return apiError("Unauthorized", 401);
    try {
        return NextResponse.json(await ensurePaymentLinkForUser(auth.user.id));
    } catch (error) {
        if (error instanceof PaymentError) {
            return NextResponse.json({ error: error.message, code: error.code }, { status: error.code === "not_found" ? 404 : 409 });
        }
        logger.error("Payment link error:", error);
        return apiError("Internal Server Error", 500);
    }
});
