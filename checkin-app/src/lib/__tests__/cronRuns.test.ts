/**
 * @jest-environment node
 */
/**
 * Staleness derivation for the cron run ledger. The DB half is a single groupBy,
 * stubbed here; what's worth testing is the rule applied to its rows — one coarse
 * window for every job, and a job that has NEVER run is not reported as stale
 * (the app can't know whether infra schedules it at all).
 */
import prisma from '@/lib/prisma';
import { CRON_STALE_AFTER_MS, cronJobName, countStaleCronJobs, getCronJobStatuses } from '@/lib/cronRuns';

const NOW = new Date('2026-08-06T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const HOUR = 60 * 60 * 1000;

/** Stub the two reads: the success aggregate, and the latest-failure-per-job scan. */
function stubGroupBy(
    rows: { job: string; finishedAt: Date | null }[],
    failures: { job: string; finishedAt: Date; error: string | null }[] = [],
) {
    prisma.cronRunLog.groupBy = jest.fn().mockResolvedValue(
        rows.map((r) => ({ job: r.job, _max: { finishedAt: r.finishedAt } })),
    );
    prisma.cronRunLog.findMany = jest.fn().mockResolvedValue(failures);
}

describe('cronJobName', () => {
    it('takes the last path segment and ignores the query string', () => {
        expect(cronJobName('http://localhost/api/cron/nightly')).toBe('nightly');
        expect(cronJobName('https://app.example.org/api/cron/post-event?force=1')).toBe('post-event');
    });

    it('tolerates a trailing slash', () => {
        expect(cronJobName('http://localhost/api/cron/nightly/')).toBe('nightly');
    });
});

describe('getCronJobStatuses', () => {
    it('marks a job stale once its last success is older than the window', async () => {
        stubGroupBy([{ job: 'nightly', finishedAt: ago(CRON_STALE_AFTER_MS + HOUR) }]);

        const statuses = await getCronJobStatuses(NOW);

        expect(statuses).toEqual([{ job: 'nightly', lastSuccessAt: ago(CRON_STALE_AFTER_MS + HOUR), stale: true }]);
    });

    it('leaves a healthy daily job alone — one missed run is inside the window', async () => {
        // 30h since the last success: a daily job that skipped one run. The window is
        // deliberately coarse enough that this must NOT alarm.
        stubGroupBy([{ job: 'nightly', finishedAt: ago(30 * HOUR) }]);

        expect((await getCronJobStatuses(NOW))[0].stale).toBe(false);
    });

    it('omits a job that has never recorded a successful run', async () => {
        // A route nothing schedules has no rows at all — absence of evidence is not a
        // missed run, and this is what stops the badge firing on all nine routes the
        // day the table ships.
        stubGroupBy([]);

        expect(await getCronJobStatuses(NOW)).toEqual([]);
        expect(await countStaleCronJobs(NOW)).toBe(0);
    });

    it('puts the stalest job first and counts only the stale ones', async () => {
        stubGroupBy([
            { job: 'nightly', finishedAt: ago(CRON_STALE_AFTER_MS + HOUR) },
            { job: 'post-event', finishedAt: ago(2 * HOUR) },
            { job: 'reconcile-shopify', finishedAt: ago(10 * 24 * HOUR) },
        ]);

        const statuses = await getCronJobStatuses(NOW);

        expect(statuses.map((s) => s.job)).toEqual(['reconcile-shopify', 'nightly', 'post-event']);
        expect(statuses.filter((s) => s.stale).map((s) => s.job)).toEqual(['reconcile-shopify', 'nightly']);
        expect(await countStaleCronJobs(NOW)).toBe(2);
    });

    it('reports the error of a job that has failed since its last success', async () => {
        stubGroupBy(
            [{ job: 'nightly', finishedAt: ago(3 * 24 * HOUR) }],
            [{ job: 'nightly', finishedAt: ago(2 * HOUR), error: 'connection refused' }],
        );

        expect(await getCronJobStatuses(NOW)).toEqual([
            { job: 'nightly', lastSuccessAt: ago(3 * 24 * HOUR), stale: true, lastError: 'connection refused' },
        ]);
    });

    it('drops a failure the job has since recovered from', async () => {
        stubGroupBy(
            [{ job: 'nightly', finishedAt: ago(2 * HOUR) }],
            [{ job: 'nightly', finishedAt: ago(3 * 24 * HOUR), error: 'connection refused' }],
        );

        const [status] = await getCronJobStatuses(NOW);
        expect(status.lastError).toBeUndefined();
        expect(status.stale).toBe(false);
    });
});
