import { NextResponse } from "next/server";
import crypto from "crypto";
import { logger } from "./logger";
import { config } from "./config";
import { cronJobName, recordCronRun } from "./cronRuns";

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
 *
 * Every completed run is stamped into CronRunLog — here rather than per-route, so
 * a cron route added later is covered without touching it. Nothing about the sweep
 * changes: the job name comes from the request path, the record is written after
 * the handler has already produced its response, and {@link recordCronRun}
 * swallows its own failures. Only AUTHORIZED runs are recorded; a 401 never
 * happened as far as the ledger is concerned.
 *
 * Success is the response STATUS, not merely "the handler didn't throw" — a route
 * that returns its own error envelope has not had a healthy run, and the ledger
 * must not claim otherwise just because nothing was thrown.
 */
export function withCron(
    handler: (req: Request) => Promise<NextResponse>,
) {
    return async (req: Request): Promise<NextResponse> => {
        const denied = requireCronSecret(req);
        if (denied) return denied;

        const job = cronJobName(req.url);
        const startedAt = new Date();

        try {
            const res = await handler(req);
            await recordCronRun(job, startedAt, res.status < 400, res.status < 400 ? undefined : `HTTP ${res.status}`);
            return res;
        } catch (error) {
            logger.error("Cron handler error:", error);
            await recordCronRun(job, startedAt, false, error);
            return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
        }
    };
}
