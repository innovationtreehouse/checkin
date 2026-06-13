/**
 * Guard against silently skipping the DB-gated integration coverage.
 *
 * Every other integration suite uses `describe.skip` when SHOPIFY_READ_DATABASE_URL is unset, which is
 * convenient locally but dangerous in CI: a misconfigured pipeline would report all-green
 * while exercising none of the real-Postgres behavior. This UNGATED test makes that failure
 * mode loud — it THROWS in CI when the DB is absent, and only warns locally.
 */
import { describe, it, expect } from "vitest";

describe("integration DB availability", () => {
  it("has SHOPIFY_READ_DATABASE_URL set in CI (so DB coverage is never silently skipped)", () => {
    if (process.env.SHOPIFY_READ_DATABASE_URL) {
      expect(process.env.SHOPIFY_READ_DATABASE_URL).toBeTruthy();
      return;
    }
    if (process.env.CI) {
      throw new Error(
        "SHOPIFY_READ_DATABASE_URL is not set but CI=true — the DB-gated integration tests would be silently skipped. " +
          "Provision a Postgres and set SHOPIFY_READ_DATABASE_URL for the integration job.",
      );
    }
    // Local dev without a DB: warn, don't fail.
    console.warn(
      "[db-availability] SHOPIFY_READ_DATABASE_URL is unset — DB-gated integration tests are being skipped. " +
        "Set SHOPIFY_READ_DATABASE_URL=postgresql://... to run them.",
    );
    expect(process.env.SHOPIFY_READ_DATABASE_URL).toBeUndefined();
  });
});
