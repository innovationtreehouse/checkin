import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/auth";
import { certifyPaymentPlan, PaymentError } from "@/lib/membership/payment";
import { apiError } from "@/lib/api-response";

export const dynamic = "force-dynamic";

/**
 * POST /api/membership-ops/applications/certify-payment — board override.
 * Certifies a payment plan and activates the membership without a Shopify payment.
 * Body: { processId }
 */
export const POST = withAuth({ roles: ["isSysadmin", "isBoardMember"] }, async (req, auth) => {
    if (auth.type !== "session") return apiError("Unauthorized", 401);
    let body: { processId?: number };
    try {
        body = await req.json();
    } catch {
        return apiError("Invalid JSON", 400);
    }
    if (!body.processId) return apiError("processId is required", 400);
    try {
        const process = await certifyPaymentPlan(body.processId, auth.user.id);
        return NextResponse.json({ process });
    } catch (error) {
        if (error instanceof PaymentError) {
            return NextResponse.json({ error: error.message, code: error.code }, { status: error.code === "not_found" ? 404 : 409 });
        }
        logger.error("Certify payment error:", error);
        return apiError("Internal Server Error", 500);
    }
});
