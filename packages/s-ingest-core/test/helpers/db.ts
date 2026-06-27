/**
 * Helper for integration suites that need a real Postgres.
 *
 * The package's integration tests (raw-log dedup, advisory locks, the reaper, bulk
 * recovery, projection) are gated on SHOPIFY_READ_DATABASE_URL. Historically each suite did
 * `process.env.SHOPIFY_READ_DATABASE_URL ? describe : describe.skip`, which skips SILENTLY — a
 * green `npm test` that exercised nothing but the two pure-unit files looks identical
 * to a full run. `describeDb` keeps the gate but makes a skip LOUD, and lets CI turn
 * an absent database into a hard failure.
 *
 *   - SHOPIFY_READ_DATABASE_URL set            → suite runs.
 *   - SHOPIFY_READ_DATABASE_URL unset          → suite is skipped AND a one-time warning is printed
 *                                   naming exactly what went unverified.
 *   - SHOPIFY_READ_DATABASE_URL unset + CI gate → throws, so CI cannot go green without the DB.
 *     The gate is on by default in CI (`process.env.CI`) and can be forced anywhere
 *     with `REQUIRE_DB=1` (or disabled with `REQUIRE_DB=0`).
 */
import { describe } from "vitest";

function dbRequired(): boolean {
  if (process.env.REQUIRE_DB === "0") return false;
  return process.env.REQUIRE_DB === "1" || !!process.env.CI;
}

let warned = false;
function warnOnce(): void {
  if (warned) return;
  warned = true;
  // process.stderr (not console.warn): vitest intercepts console at suite-collection
  // time, which would swallow this — and being swallowed is the exact failure mode
  // this warning exists to prevent.
  process.stderr.write(
    "\n[33m⚠  SHOPIFY_READ_DATABASE_URL is not set — skipping s-ingest-core INTEGRATION suites.\n" +
      "   Left unverified: raw-log dedup/concurrency, advisory locks, the stale-run reaper,\n" +
      "   bulk-export capture + recovery, watermark advance, and live-table projection.\n" +
      "   Run them with:  SHOPIFY_READ_DATABASE_URL=postgresql://… npm test  (set REQUIRE_DB=1 to enforce)[0m\n",
  );
}

/**
 * `describe` for a suite that requires SHOPIFY_READ_DATABASE_URL. Runs the suite when the env var is
 * present; otherwise skips loudly (or throws when the DB is required, e.g. in CI).
 */
export function describeDb(name: string, fn: () => void): void {
  if (process.env.SHOPIFY_READ_DATABASE_URL) {
    describe(name, fn);
    return;
  }
  if (dbRequired()) {
    throw new Error(
      `SHOPIFY_READ_DATABASE_URL is required to run integration suite "${name}" (CI / REQUIRE_DB=1) but it is not set.`,
    );
  }
  warnOnce();
  describe.skip(name, fn);
}
