import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { certifyPaymentPlan, PaymentError } from "@/lib/membership/payment";

export const dynamic = "force-dynamic";

/**
 * POST /api/membership-ops/applications/certify-payment — board override.
 * Certifies a payment plan and activates the membership without a Shopify payment.
 * Body: { processId }
 */
export const POST = withAuth({ roles: ["isSysadmin", "isBoardMember"] }, async (req, auth) => {
    if (auth.type !== "session") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    let body: { processId?: number };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (!body.processId) return NextResponse.json({ error: "processId is required" }, { status: 400 });
    try {
        const process = await certifyPaymentPlan(body.processId, auth.user.id);
        return NextResponse.json({ process });
    } catch (error) {
        if (error instanceof PaymentError) {
            return NextResponse.json({ error: error.message, code: error.code }, { status: error.code === "not_found" ? 404 : 409 });
        }
        console.error("Certify payment error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
});
