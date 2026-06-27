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
            if ((error as { code?: string })?.code !== "P1001" || i >= attempts) throw error;
            await new Promise((r) => setTimeout(r, delayMs));
        }
    }
}
