/**
 * Unit tests for withAdvisoryLock. A fake `$queryRaw` drives the two SQL round-trips
 * (try-lock, then unlock) deterministically so we can exercise every branch — including
 * the package-specific `onUnlockError` path that no integration test can reliably trigger.
 * Cross-session exclusion against real Postgres lives in test/integration/lock.test.ts.
 */
import { describe, it, expect, vi } from "vitest";
import { withAdvisoryLock, ConcurrentRunError } from "./lock.js";
import type { PrismaClient } from "./generated/prisma/client.js";

/** `$queryRaw` is called as a tagged template; a plain fn is a sufficient stand-in. */
function prismaWith(queryRaw: ReturnType<typeof vi.fn>): PrismaClient {
  return { $queryRaw: queryRaw } as unknown as PrismaClient;
}

describe("withAdvisoryLock", () => {
  it("runs fn, returns its result, and releases the lock when acquisition succeeds", async () => {
    const q = vi
      .fn()
      .mockResolvedValueOnce([{ locked: true }]) // pg_try_advisory_lock
      .mockResolvedValueOnce([{}]); // pg_advisory_unlock
    const fn = vi.fn().mockResolvedValue("ok");

    const res = await withAdvisoryLock(prismaWith(q), "k", fn);

    expect(res).toBe("ok");
    expect(fn).toHaveBeenCalledOnce();
    expect(q).toHaveBeenCalledTimes(2); // lock + unlock
  });

  it("throws ConcurrentRunError without running fn or unlocking when the lock is held", async () => {
    const q = vi.fn().mockResolvedValueOnce([{ locked: false }]);
    const fn = vi.fn();

    const err = await withAdvisoryLock(prismaWith(q), "mykey", fn).catch((e) => e);

    expect(err).toBeInstanceOf(ConcurrentRunError);
    expect(err.lockKey).toBe("mykey");
    expect(fn).not.toHaveBeenCalled();
    expect(q).toHaveBeenCalledTimes(1); // never attempted unlock
  });

  it("still releases the lock when fn throws, and rethrows fn's error", async () => {
    const q = vi
      .fn()
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([{}]);
    const fn = vi.fn().mockRejectedValue(new Error("boom"));

    await expect(withAdvisoryLock(prismaWith(q), "k", fn)).rejects.toThrow("boom");
    expect(q).toHaveBeenCalledTimes(2); // unlock ran in finally despite the throw
  });

  it("reports a failed unlock via onUnlockError but still returns fn's result", async () => {
    const unlockErr = new Error("unlock failed");
    const q = vi
      .fn()
      .mockResolvedValueOnce([{ locked: true }])
      .mockRejectedValueOnce(unlockErr);
    const onUnlockError = vi.fn();

    const res = await withAdvisoryLock(prismaWith(q), "k", vi.fn().mockResolvedValue(42), onUnlockError);

    expect(res).toBe(42); // a failed release is non-fatal
    expect(onUnlockError).toHaveBeenCalledWith(unlockErr);
  });

  it("swallows a failed unlock silently when no onUnlockError callback is given", async () => {
    const q = vi
      .fn()
      .mockResolvedValueOnce([{ locked: true }])
      .mockRejectedValueOnce(new Error("unlock failed"));

    await expect(withAdvisoryLock(prismaWith(q), "k", vi.fn().mockResolvedValue(7))).resolves.toBe(7);
  });
});
