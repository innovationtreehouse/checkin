/**
 * Integration test for the advisory-lock concurrency guard (F19). Skipped unless SHOPIFY_READ_DATABASE_URL
 * is set. Two PrismaClients = two DB sessions, the same shape as two Lambda execution
 * environments — the real concurrency hazard the lock defends against. Each client pins a
 * single connection (`connection_limit=1`, the documented prod config) so acquire and release
 * land on the same session.
 */
import { it, expect, beforeAll, afterAll } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { withAdvisoryLock, ConcurrentRunError } from "../../src/sync/locks.js";
import { describeDb } from "../helpers/db.js";

function singleConnClient(): PrismaClient {
  // Prisma 7 connects through a driver adapter, not a `datasourceUrl` string. We pin the
  // pg pool to a single connection (`max: 1`) — the v7 equivalent of the old
  // `connection_limit=1` URL param — so acquire and release land on the same session.
  const adapter = new PrismaPg({ connectionString: process.env.SHOPIFY_READ_DATABASE_URL as string, max: 1 });
  return new PrismaClient({ adapter });
}

describeDb("withAdvisoryLock", () => {
  // Created in beforeAll (not at suite-collection time) so a skipped run without SHOPIFY_READ_DATABASE_URL
  // never dereferences the missing env var.
  let a: PrismaClient;
  let b: PrismaClient;
  beforeAll(() => {
    a = singleConnClient();
    b = singleConnClient();
  });
  afterAll(async () => {
    await a?.$disconnect();
    await b?.$disconnect();
  });

  it("rejects a second holder while the first holds the lock, then admits it after release", async () => {
    const key = "test-advisory-lock:exclusion";

    await withAdvisoryLock(a, key, async () => {
      // While A holds the lock, a different session (B) must fail fast — not block.
      await expect(withAdvisoryLock(b, key, async () => "ran")).rejects.toBeInstanceOf(ConcurrentRunError);
    });

    // A has released — B can now take it.
    const result = await withAdvisoryLock(b, key, async () => "ran");
    expect(result).toBe("ran");
  });

  it("returns the callback result and releases the lock even when the callback throws", async () => {
    const key = "test-advisory-lock:release-on-throw";

    await expect(
      withAdvisoryLock(a, key, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // The lock was released in `finally`, so it can be re-acquired (here by a different session).
    expect(await withAdvisoryLock(b, key, async () => 42)).toBe(42);
  });

  it("lets different keys run concurrently", async () => {
    await withAdvisoryLock(a, "test-advisory-lock:key-1", async () => {
      // A holds key-1; B taking key-2 is unrelated and must succeed.
      const r = await withAdvisoryLock(b, "test-advisory-lock:key-2", async () => "ok");
      expect(r).toBe("ok");
    });
  });
});
