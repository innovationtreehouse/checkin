/**
 * The heartbeat sink wiring (monitoring.ts): whether a sink is built at all, and —
 * the part that actually matters — that the built sink forwards a RunHeartbeat to
 * recordHeartbeat with the fields mapped through and the service/env defaults (and
 * overrides) applied.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { recordHeartbeat } = vi.hoisted(() => ({ recordHeartbeat: vi.fn() }));
vi.mock("@inventory/monitoring-db", () => ({
  prisma: { __fake: true },
  recordHeartbeat,
}));

import { buildHeartbeatSink } from "../../src/monitoring.js";

beforeEach(() => vi.clearAllMocks());

describe("buildHeartbeatSink", () => {
  it("returns undefined when monitoring is not configured (no MONITORING_DATABASE_URL)", () => {
    // Without a monitoring DB the service simply doesn't push — local dev / inject stay quiet.
    expect(buildHeartbeatSink({})).toBeUndefined();
  });

  it("returns a sink function when MONITORING_DATABASE_URL is set", () => {
    const sink = buildHeartbeatSink({ MONITORING_DATABASE_URL: "postgresql://localhost/monitoring" } as NodeJS.ProcessEnv);
    expect(typeof sink).toBe("function");
  });

  it("forwards the heartbeat to recordHeartbeat with default service/env", async () => {
    const sink = buildHeartbeatSink({ MONITORING_DATABASE_URL: "postgresql://localhost/monitoring" } as NodeJS.ProcessEnv)!;
    const finishedAt = new Date("2026-06-10T00:00:00Z");
    await sink({ storeId: "s", kind: "INCREMENTAL", status: "COMPLETED", finishedAt, error: null } as never);

    expect(recordHeartbeat).toHaveBeenCalledWith(expect.anything(), {
      service: "shopify-read",
      env: "dev",
      status: "COMPLETED",
      finishedAt,
      error: null,
      kind: "INCREMENTAL",
    });
  });

  it("honors SERVICE_NAME and MONITORING_ENV overrides", async () => {
    const sink = buildHeartbeatSink({
      MONITORING_DATABASE_URL: "postgresql://localhost/monitoring",
      SERVICE_NAME: "shopify-read-eu",
      MONITORING_ENV: "prod",
    } as NodeJS.ProcessEnv)!;
    await sink({ storeId: "s", kind: "BACKFILL", status: "FAILED", finishedAt: new Date(), error: "boom" } as never);

    expect(recordHeartbeat).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ service: "shopify-read-eu", env: "prod", status: "FAILED", error: "boom", kind: "BACKFILL" }),
    );
  });
});
