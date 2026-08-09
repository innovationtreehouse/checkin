import prisma from "./prisma";

/**
 * How long a job may go without a successful run before it counts as stale.
 *
 * ONE coarse constant for every job, deliberately — there is no per-job schedule
 * here and there must not be one. The schedule and the caller live in a separate
 * infra repository (an EventBridge rule invoking a Lambda that calls the route),
 * so any expected-interval table copied into this repo would rot the moment
 * someone retimes a job there, and would then either cry wolf or go quiet. 48h is
 * picked to be unfalsifiable in both directions: generous enough that a daily job
 * can miss a run, a deploy window, or a clock skew without alarming, and strict
 * enough that a job which genuinely stopped surfaces within two days.
 */
export const CRON_STALE_AFTER_MS = 48 * 60 * 60 * 1000;

/**
 * Last successful run of one cron job, and whether that is too long ago.
 * `lastError` is set only when the job has failed SINCE its last success — i.e. when it
 * is still broken. A failure the job later recovered from is history, not a status.
 */
export type CronJobStatus = { job: string; lastSuccessAt: Date; stale: boolean; lastError?: string };

/** Route slug for the run ledger: the last path segment of /api/cron/<job>. */
export function cronJobName(url: string): string {
    const path = new URL(url).pathname.replace(/\/+$/, "");
    return path.slice(path.lastIndexOf("/") + 1) || "unknown";
}

/**
 * Records one completed cron run, then purges rows older than 90 days.
 *
 * Never throws and never rethrows: recording that a job ran must not change
 * whether the job ran or what it returned. A failed write degrades the System
 * Status panel, not the sweep.
 *
 * ponytail: the TTL purge runs inline on each write rather than from its own
 * sweep — writes are ~9/day, and a cron to prune the cron log would be the exact
 * circularity this table exists to detect. Same pattern as logIntegrationError.
 */
export async function recordCronRun(job: string, startedAt: Date, success: boolean, error?: unknown) {
    try {
        await prisma.cronRunLog.create({
            data: {
                job,
                startedAt,
                success,
                error: error === undefined ? null : error instanceof Error ? error.message : String(error),
            },
        });

        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
        await prisma.cronRunLog.deleteMany({ where: { finishedAt: { lt: ninetyDaysAgo } } });
    } catch (writeError) {
        console.error("Failed to record cron run:", writeError);
    }
}

/**
 * Most recent successful run per job.
 *
 * Only jobs with a recorded success appear. A route that has never run is not
 * reported as stale, because the app has no way to know whether infra schedules
 * it at all — absence of evidence isn't a missed run, and it also keeps the badge
 * from firing on all nine routes the moment this table ships. The corollary: a job
 * that stops and stays stopped drops off the list once the 90-day purge takes its
 * last success, long after the badge has been red about it.
 */
async function lastSuccessByJob(): Promise<Map<string, Date>> {
    const rows = await prisma.cronRunLog.groupBy({
        by: ["job"],
        where: { success: true },
        _max: { finishedAt: true },
    });

    const out = new Map<string, Date>();
    for (const r of rows) if (r._max.finishedAt) out.set(r.job, r._max.finishedAt);
    return out;
}

/**
 * Every job that has ever succeeded, most-stale first so the problems are at the
 * top of the panel. Carries the failure message when the job has thrown since its
 * last success — a red row that names what broke is actionable; one that only says
 * "stopped" sends the reader to CloudWatch.
 */
export async function getCronJobStatuses(now: Date = new Date()): Promise<CronJobStatus[]> {
    const [successes, failures] = await Promise.all([
        lastSuccessByJob(),
        // Latest failure per job. `distinct` after an ordered scan rather than a
        // correlated subquery: the table is ~one row per job per day under a 90-day
        // TTL, so there is nothing here worth optimising.
        prisma.cronRunLog.findMany({
            where: { success: false },
            orderBy: [{ job: "asc" }, { finishedAt: "desc" }],
            distinct: ["job"],
            select: { job: true, finishedAt: true, error: true },
        }),
    ]);

    const latestFailure = new Map(failures.map((f) => [f.job, f]));

    return [...successes.entries()]
        .map(([job, lastSuccessAt]) => {
            const failure = latestFailure.get(job);
            return {
                job,
                lastSuccessAt,
                stale: now.getTime() - lastSuccessAt.getTime() > CRON_STALE_AFTER_MS,
                // A failure the job has since recovered from is history, not status.
                ...(failure && failure.finishedAt > lastSuccessAt ? { lastError: failure.error ?? "unknown error" } : {}),
            };
        })
        .sort((a, b) => a.lastSuccessAt.getTime() - b.lastSuccessAt.getTime());
}

/**
 * Count of jobs past {@link CRON_STALE_AFTER_MS} — the nav-badge number. Reads only
 * the success aggregate: this runs on the hot nav-poll path, where the panel's
 * failure detail would be dead weight.
 */
export async function countStaleCronJobs(now: Date = new Date()): Promise<number> {
    let stale = 0;
    for (const lastSuccessAt of (await lastSuccessByJob()).values()) {
        if (now.getTime() - lastSuccessAt.getTime() > CRON_STALE_AFTER_MS) stale += 1;
    }
    return stale;
}
