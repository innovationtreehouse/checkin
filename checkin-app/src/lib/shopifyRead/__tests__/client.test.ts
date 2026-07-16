/**
 * @jest-environment node
 */
/**
 * Unit tests for the mirror client's sync-status read. `pg` is mocked — this covers
 * the wiring the reconciler's integration tests don't: that an unconfigured env never
 * opens a pool at all, and that the read is a single newest-first row.
 *
 * The client caches its Pool in a module-level singleton, so each case re-imports the
 * module under jest.isolateModules to get a fresh one.
 */
const queryMock = jest.fn();
const poolCtor = jest.fn();

jest.mock('pg', () => ({
    Pool: jest.fn().mockImplementation((...args: unknown[]) => {
        poolCtor(...args);
        return { query: queryMock, on: jest.fn() };
    }),
}));

type Client = typeof import('../client');

/** Load a fresh copy of the client against the current process.env. */
function freshClient(): Client {
    let mod!: Client;
    jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        mod = require('../client');
    });
    return mod;
}

const MIRROR_URL = 'postgresql://s_read_dev_ro:pw@host:5432/shopify_read_dev';
const prevUrl = process.env.SHOPIFY_READ_DATABASE_URL;

beforeEach(() => {
    jest.clearAllMocks();
    process.env.SHOPIFY_READ_DATABASE_URL = MIRROR_URL;
});

afterAll(() => {
    if (prevUrl === undefined) delete process.env.SHOPIFY_READ_DATABASE_URL;
    else process.env.SHOPIFY_READ_DATABASE_URL = prevUrl;
});

describe('latestSyncRun', () => {
    it('returns null without opening a pool when the mirror is unwired', async () => {
        delete process.env.SHOPIFY_READ_DATABASE_URL;
        const client = freshClient();

        expect(client.isConfigured()).toBe(false);
        expect(await client.latestSyncRun()).toBeNull();
        // The load-bearing half: an env with no mirror must not connect to anything.
        expect(poolCtor).not.toHaveBeenCalled();
        expect(queryMock).not.toHaveBeenCalled();
    });

    it('returns the most recent run', async () => {
        const row = {
            status: 'COMPLETED',
            kind: 'INCREMENTAL',
            startedAt: new Date('2026-07-16T09:00:00Z'),
            finishedAt: new Date('2026-07-16T09:02:00Z'),
            counts: { orders: 12 },
            error: null,
        };
        queryMock.mockResolvedValue({ rows: [row] });

        expect(await freshClient().latestSyncRun()).toEqual(row);
    });

    it('returns null when the mirror has never run a sync', async () => {
        queryMock.mockResolvedValue({ rows: [] });
        expect(await freshClient().latestSyncRun()).toBeNull();
    });

    it('reads exactly one row, newest first', async () => {
        queryMock.mockResolvedValue({ rows: [] });
        await freshClient().latestSyncRun();

        const sql = queryMock.mock.calls[0][0].replace(/\s+/g, ' ');
        expect(sql).toContain('FROM sync_run');
        expect(sql).toContain('ORDER BY started_at DESC');
        expect(sql).toContain('LIMIT 1');
    });

    it("pins both timestamps to UTC", async () => {
        queryMock.mockResolvedValue({ rows: [] });
        await freshClient().latestSyncRun();

        // s-read's columns are `timestamp WITHOUT time zone` holding UTC, and node-pg
        // resolves those against the Node process's zone — drop these casts and a
        // non-UTC container reports a 12-minute-old sync as "just now" (a future
        // instant makes the age negative). Caught by driving the real page on a
        // Chicago-zoned laptop; nothing else fails if this regresses.
        const sql = queryMock.mock.calls[0][0].replace(/\s+/g, ' ');
        expect(sql).toContain(`started_at AT TIME ZONE 'UTC'`);
        expect(sql).toContain(`finished_at AT TIME ZONE 'UTC'`);
    });

    it('honours the scale-to-zero pool invariant', async () => {
        queryMock.mockResolvedValue({ rows: [] });
        await freshClient().latestSyncRun();

        // min 0 + a finite idle reap is what lets the shared Aurora cluster auto-pause;
        // a pool that holds a connection open would keep it awake forever (PR #1030).
        const opts = poolCtor.mock.calls[0][0];
        expect(opts.min).toBe(0);
        expect(opts.idleTimeoutMillis).toBeGreaterThan(0);
    });
});
