/**
 * Cross-process mutual exclusion via Postgres session-scoped advisory locks (F19).
 *
 * The monitoring relay and watchdog are *intended* to run at reserved concurrency = 1, but
 * that flag is invisible to the code. This wraps a unit of work in a Postgres advisory lock
 * so two overlapping invocations cannot drain the outbox / record incidents concurrently: a
 * second caller that can't take the lock fails fast with {@link ConcurrentRunError}.
 *
 * Uses the SESSION-scoped `pg_try_advisory_lock` / `pg_advisory_unlock` pair so the lock
 * outlives the short transactions inside a run; it auto-releases when the DB session ends, so
 * a crashed process never leaks it. Acquire and release must land on the same pooled
 * connection — guaranteed under the documented `connection_limit=1` config (see `db/client.ts`).
 * Cross-process exclusion (two Lambda environments) works regardless, since each is a distinct
 * session. This package stays logger-free (Prisma-only dependency), so a failed unlock is
 * surfaced via the optional `onUnlockError` callback rather than a bundled logger.
 */
import type { PrismaClient } from "./generated/prisma/client.js";

/** Thrown when an advisory lock is already held — the caller should treat it as a benign skip. */
export class ConcurrentRunError extends Error {
  constructor(public readonly lockKey: string) {
    super(`advisory lock "${lockKey}" is already held by another run`);
    this.name = "ConcurrentRunError";
  }
}

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
 * immediately if another holder owns it. The lock is released in `finally`; a failed release
 * is non-fatal (it auto-releases on session end) and reported via `onUnlockError` if given.
 */
export async function withAdvisoryLock<T>(
  prisma: PrismaClient,
  key: string,
  fn: () => Promise<T>,
  onUnlockError?: (err: unknown) => void,
): Promise<T> {
  if (!(await tryAdvisoryLock(prisma, key))) throw new ConcurrentRunError(key);
  try {
    return await fn();
  } finally {
    try {
      await advisoryUnlock(prisma, key);
    } catch (err) {
      onUnlockError?.(err);
    }
  }
}
