import { PrismaClient } from '@/generated/prisma/client'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'

const connectionString = `${process.env.DATABASE_URL}`
// Tests default to a single connection so suites don't exhaust a small CI
// Postgres. TEST_DB_POOL_MAX lets a suite opt into a larger pool: the scan
// concurrency suite needs >= 2 so two scan transactions run on separate
// connections — that's the only way the per-participant advisory lock (not the
// $transaction wrapping) is what serializes them, matching production (pool 10).
const poolMax = process.env.NODE_ENV === 'test'
    ? Number(process.env.TEST_DB_POOL_MAX ?? 1)
    : 10
const pool = new Pool({
    connectionString,
    max: poolMax,
    // Fail fast rather than hang forever if the pool can't get a connection (the
    // pg driver has NO default here — an exhausted/unresponsive server otherwise
    // blocks a new connection attempt indefinitely, with no error, no timeout).
    connectionTimeoutMillis: 10_000,
    // Off by default in the pg driver. Without it, a connection whose peer died
    // abruptly (SIGKILL'd process, torn-down background job — not a graceful
    // $disconnect()) looks alive to Postgres forever: no FIN was ever sent, and
    // nothing here ever probes it. If that connection was mid-transaction holding
    // a lock (e.g. the scan route's `pg_advisory_xact_lock`, checkin-app/src/app/api/scan/route.ts),
    // the lock is held until Postgres's OWN keepalive notices — which never
    // happens without this — so any later query needing that same lock hangs
    // indefinitely (issue #688: "20+ min no response", not fixed by --forceExit,
    // since that only governs whether the LATER run's own process exits, not
    // whether an EARLIER orphaned one is still silently holding a lock).
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
})
// In tests every file gets a fresh module registry, so each builds its own pool.
// Those pools must close on $disconnect or they leak connections until the worker
// process dies (parallel runs exhaust max_connections; --runInBand crashes). The
// pg adapter only ends an *external* pool when told to, so opt in under test. Prod
// keeps its single long-lived pool untouched.
const adapter = new PrismaPg(pool, process.env.NODE_ENV === 'test' ? { disposeExternalPool: true } : undefined)

const prismaClientSingleton = () => {
    return new PrismaClient({ adapter })
}

declare const globalThis: {
    prismaGlobal: ReturnType<typeof prismaClientSingleton>;
} & typeof global;

const prisma = globalThis.prismaGlobal ?? prismaClientSingleton()

export default prisma

if (process.env.NODE_ENV !== 'production') globalThis.prismaGlobal = prisma
