/**
 * Integration test for the heartbeat upsert/read round-trip against real Postgres. Proves
 * the doc-comment's monotonicity claim — that a success and a later failure each advance
 * only their own column, so the watchdog can still distinguish STALE from ERRORING — and
 * the env/service filtering of the read. Skipped unless MONITORING_DATABASE_URL is set.
 */
import { it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { recordHeartbeat, readServiceHeartbeats } from "../../src/heartbeat.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { runIfDb, singleConnClient, resetTables } from "./db.js";

runIfDb("heartbeat round-trip (integration)", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = singleConnClient();
  });
  afterAll(async () => {
    await prisma?.$disconnect();
  });
  beforeEach(() => resetTables(prisma));

  it("keeps success and failure in independent columns across upserts", async () => {
    const success = new Date("2026-06-09T10:00:00Z");
    const failure = new Date("2026-06-09T11:00:00Z");
    await recordHeartbeat(prisma, { service: "a", env: "prod", status: "COMPLETED", finishedAt: success, kind: "INCREMENTAL" });
    await recordHeartbeat(prisma, { service: "a", env: "prod", status: "FAILED", finishedAt: failure, error: "boom" });

    const map = await readServiceHeartbeats(prisma, "prod", ["a"]);
    const freshness = map.get("a");
    expect(freshness?.lastFinishedAt).toEqual(success); // success column preserved through the failure
    expect(freshness?.latestFailure).toEqual({ failedAt: failure, error: "boom" });
  });

  it("omits a service that has never reported", async () => {
    const map = await readServiceHeartbeats(prisma, "prod", ["ghost"]);
    expect(map.has("ghost")).toBe(false);
  });

  it("filters heartbeats by env", async () => {
    const now = new Date("2026-06-09T12:00:00Z");
    await recordHeartbeat(prisma, { service: "a", env: "prod", status: "COMPLETED", finishedAt: now });
    await recordHeartbeat(prisma, { service: "a", env: "staging", status: "COMPLETED", finishedAt: now });

    const map = await readServiceHeartbeats(prisma, "prod", ["a"]);
    expect(map.size).toBe(1);
    expect(map.has("a")).toBe(true);
  });
});
