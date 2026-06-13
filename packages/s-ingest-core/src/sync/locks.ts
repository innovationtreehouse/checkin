/**
 * Cross-process mutual exclusion via Postgres session-scoped advisory locks.
 *
 * F19 defense-in-depth. The ingestion fleet is *intended* to run at Lambda reserved
 * concurrency = 1, but the correctness of raw-log dedup, watermark advance, and the bulk
 * state machine must not REST on that deployment flag alone — a flag is invisible to the
 * code and silently absent if a new service copies the handler shape but forgets the
 * setting. This wraps a unit of work in a Postgres advisory lock so two overlapping
 * invocations for the same key cannot run concurrently: a second caller that can't take
 * the lock fails fast with {@link ConcurrentRunError} instead of corrupting state.
 *
 * Session vs. transaction scope: a run spans many short transactions, so the lock must
 * outlive any single one. We therefore use the SESSION-scoped `pg_try_advisory_lock` /
 * `pg_advisory_unlock` pair — not the transaction-scoped `pg_advisory_xact_lock` used for
 * the single-statement dedup in `rawLog.ts` (F6). Session locks auto-release when the DB
 * session ends, so a crashed process never leaks the lock permanently.
 *
 * Deployment contract (the explicit, checked half of the fix): acquire and release must
 * land on the SAME pooled connection. Under the documented prod config — `connection_limit=1`
 * with RDS Proxy / pgBouncer session pinning (see `db/client.ts`) — the Prisma pool holds a
 * single connection, so this holds. Cross-PROCESS exclusion, which is the real concurrency
 * hazard (two Lambda execution environments → two distinct sessions), works regardless. The
 * worst case if a release is delayed (a stray extra pooled connection) is brief
 * over-serialization bounded by the session lifetime — never data corruption, and never
 * worse than the comment-only assumption it replaces.
 */
import type { PrismaClient } from "../db/client.js";
import { logger } from "../logger.js";

/** Thrown when an advisory lock is already held — the caller should treat it as a benign skip. */
export class ConcurrentRunError extends Error {
  constructor(public readonly lockKey: string) {
    super(`advisory lock "${lockKey}" is already held by another run`);
    this.name = "ConcurrentRunError";
  }
}

/** Non-blocking acquire. Returns false (does not wait) when another session holds the key. */
async function tryAdvisoryLock(prisma: PrismaClient, key: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_try_advisory_lock(hashtextextended(${key}, 0)) AS locked`;
  return rows[0]?.locked === true;
}

async function advisoryUnlock(prisma: PrismaClient, key: string): Promise<void> {
  await prisma.$queryRaw`SELECT pg_advisory_unlock(hashtextextended(${key}, 0))`;
}

/**
 * Run `fn` while holding the advisory lock for `key`; throw {@link ConcurrentRunError}
 * immediately if another holder owns it. The lock is released in `finally`; a failed
 * release is logged but non-fatal, since the lock auto-releases when the session ends.
 */
export async function withAdvisoryLock<T>(
  prisma: PrismaClient,
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!(await tryAdvisoryLock(prisma, key))) throw new ConcurrentRunError(key);
  try {
    return await fn();
  } finally {
    try {
      await advisoryUnlock(prisma, key);
    } catch (err) {
      logger.warn("failed to release advisory lock (auto-releases on session end)", { key, err });
    }
  }
}
