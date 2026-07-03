import { NextResponse } from "next/server";
import crypto from "crypto";
import { logger } from "./logger";
import { config } from "./config";

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
    const cronSecret = config.cronSecret();

    if (!cronSecret || !authHeader) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const expectedHeader = `Bearer ${cronSecret}`;

    // Hash both values to ensure fixed length before comparison to avoid leaking the secret length
    const providedBuffer = crypto.createHash('sha256').update(authHeader).digest();
    const expectedBuffer = crypto.createHash('sha256').update(expectedHeader).digest();

    if (!crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return null;
}

/**
 * Higher-order wrapper for the cron routes — mirrors {@link withAuth} but for the
 * session-less cron family. Gates on {@link requireCronSecret} (so the handler
 * never runs unauthorized), then runs the handler inside a top-level catch that
 * logs and returns a 500 so a thrown handler can't escape as an unhandled
 * rejection. The handler owns its own success envelope.
 *
 *   export const GET = withCron(async () => {
 *       const result = await runSweep();
 *       return NextResponse.json({ success: true, ...result });
 *   });
 */
export function withCron(
    handler: (req: Request) => Promise<NextResponse>,
) {
    return async (req: Request): Promise<NextResponse> => {
        const denied = requireCronSecret(req);
        if (denied) return denied;

        try {
            return await handler(req);
        } catch (error) {
            logger.error("Cron handler error:", error);
            return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
        }
    };
}
