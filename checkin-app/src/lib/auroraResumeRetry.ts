import { Prisma } from '@/generated/prisma/client'

// The cloud dev DB is Aurora Serverless v2 with min-capacity 0 + auto-pause; the
// first connection after idle races the ~30s resume and Prisma throws P1001
// ("Can't reach database server"). The deploy workflow already retries migrations
// for this same race (see .github/workflows/deploy-dev.yml). Mirror it here for the
// jwt-callback reads (auth-options.ts) so a cold start doesn't surface as NextAuth's
// generic `Callback` error. Short backoff only — this runs in the sign-in request
// path, not a one-off migrate task. Retries ONLY on P1001; rethrows everything else.
export async function withAuroraResumeRetry<T>(
    fn: () => Promise<T>,
    attempts = 5,
    delayMs = 600,
): Promise<T> {
    for (let i = 1; ; i++) {
        try {
            return await fn();
        } catch (error) {
            if (!isDbResumeError(error) || i >= attempts) throw error;
            await new Promise((r) => setTimeout(r, delayMs));
        }
    }
}

/**
 * Client-wide variant of the same retry, applied to EVERY Prisma operation via
 * a query extension (see lib/prisma.ts). Where withAuroraResumeRetry protects a
 * single hot path with a ~3s budget, this rides out the full ~30s resume so a
 * request that lands mid-wake completes late instead of failing with a generic
 * 500 — the DbWakeNotice banner (components/DbWakeNotice.tsx) explains the wait
 * to the user in the meantime. Retrying is safe for writes because every
 * signature below is a CONNECTION-ACQUISITION failure — the connection never
 * reached the server, so the query never ran. Mid-query drops (e.g.
 * "connection terminated unexpectedly") are deliberately NOT retried: the
 * statement may have executed.
 */
export const AURORA_RESUME_DEADLINE_MS = 45_000;
const RESUME_RETRY_DELAY_MS = 2_000;

/**
 * Connection-phase failures a resuming Aurora produces. P1001 is Prisma's
 * can't-reach-server; the pg driver-adapter pool can independently time out
 * ACQUIRING a connection mid-resume (connectionTimeoutMillis, 10s in
 * lib/prisma.ts) — that surfaces as P2024 or the pool's own "timeout exceeded
 * when trying to connect" message, not P1001, which is how the public
 * programs directory 500'd at ~30s (three sequential 10s pool timeouts)
 * instead of riding out the resume.
 *
 * "Connection terminated due to connection timeout" is the pg *client's* own
 * connectionTimeoutMillis firing while the socket is still connecting — again a
 * connection-ACQUISITION failure (the connection never established, the query
 * never ran), distinct from a mid-query "connection terminated UNEXPECTEDLY"
 * drop, which we still must not retry. Missing it meant the jwt-callback role
 * re-sync (auth-options.ts) threw against a paused DB instead of riding out the
 * resume, surfacing as NextAuth JWT_SESSION_ERROR — i.e. users bounced to
 * sign-in ~15min (updateAge) into an idle-then-return, and flaky cold sign-in
 * (adapter_error_getUserByAccount). Prod evidence: 2026-07-19/20.
 */
export function isDbResumeError(error: unknown): boolean {
    const e = error as { code?: string; message?: string } | null;
    if (!e) return false;
    if (e.code === 'P1001' || e.code === 'P2024') return true;
    return typeof e.message === 'string'
        && /timeout exceeded when trying to connect|connection terminated due to connection timeout/i.test(e.message);
}

/** Deadline-based sibling of withAuroraResumeRetry (exported for tests). */
export async function retryP1001UntilDeadline<T>(
    fn: () => Promise<T>,
    deadlineMs = AURORA_RESUME_DEADLINE_MS,
    delayMs = RESUME_RETRY_DELAY_MS,
): Promise<T> {
    const deadline = Date.now() + deadlineMs;
    for (;;) {
        try {
            return await fn();
        } catch (error) {
            if (!isDbResumeError(error) || Date.now() >= deadline) throw error;
            await new Promise((r) => setTimeout(r, delayMs));
        }
    }
}

export const auroraResumeRetryExtension = Prisma.defineExtension({
    name: 'aurora-resume-retry',
    query: {
        $allOperations({ args, query }) {
            return retryP1001UntilDeadline(() => query(args));
        },
    },
});
