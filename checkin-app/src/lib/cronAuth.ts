import { NextResponse } from "next/server";
import crypto from "crypto";

/**
 * Shared auth gate for the cron routes. Checks `Authorization: Bearer $CRON_SECRET`
 * with a length guard before the timing-safe compare. Returns a 401 NextResponse
 * when unauthorized (missing header, unset CRON_SECRET, length mismatch, or wrong
 * token), or null when the request is authorized.
 *
 *   const denied = requireCronSecret(req);
 *   if (denied) return denied;
 */
export function requireCronSecret(req: Request): NextResponse | null {
    const authHeader = req.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret || !authHeader) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const expectedHeader = `Bearer ${cronSecret}`;
    const providedBuffer = Buffer.from(authHeader);
    const expectedBuffer = Buffer.from(expectedHeader);

    if (providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return null;
}
