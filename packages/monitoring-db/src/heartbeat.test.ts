import { describe, it, expect, vi } from "vitest";
import {
  heartbeatWriteFields,
  recordHeartbeat,
  createHeartbeatSink,
  readServiceHeartbeats,
  ERROR_EXCERPT_MAX,
} from "./heartbeat.js";
import type { PrismaClient } from "./generated/prisma/client.js";

const finishedAt = new Date("2026-06-09T12:00:00Z");

describe("heartbeatWriteFields", () => {
  it("a COMPLETED beat advances last_success_at and touches no failure column", () => {
    const f = heartbeatWriteFields({
      service: "shopify-read",
      env: "prod",
      status: "COMPLETED",
      finishedAt,
      kind: "INCREMENTAL",
    });
    expect(f).toEqual({ lastSuccessAt: finishedAt, lastStatus: "COMPLETED", lastKind: "INCREMENTAL" });
    expect(f.lastFailureAt).toBeUndefined();
    expect(f.lastError).toBeUndefined();
  });

  it("a FAILED beat advances last_failure_at + last_error and touches no success column", () => {
    const f = heartbeatWriteFields({
      service: "shopify-read",
      env: "prod",
      status: "FAILED",
      finishedAt,
      error: "boom",
      kind: "BACKFILL",
    });
    expect(f).toEqual({
      lastFailureAt: finishedAt,
      lastError: "boom",
      lastStatus: "FAILED",
      lastKind: "BACKFILL",
    });
    expect(f.lastSuccessAt).toBeUndefined();
  });

  it("ignores any error text on a success (a success carries no error)", () => {
    const f = heartbeatWriteFields({ service: "s", env: "e", status: "COMPLETED", finishedAt, error: "ignored" });
    expect(f.lastError).toBeUndefined();
    expect(f.lastSuccessAt).toBe(finishedAt);
  });

  it("truncates a long failure error to the excerpt cap", () => {
    const long = "x".repeat(ERROR_EXCERPT_MAX + 500);
    const f = heartbeatWriteFields({ service: "s", env: "e", status: "FAILED", finishedAt, error: long });
    expect(f.lastError).toHaveLength(ERROR_EXCERPT_MAX);
  });

  it("treats a non-COMPLETED status (e.g. ABANDONED) as a failure", () => {
    const f = heartbeatWriteFields({ service: "s", env: "e", status: "ABANDONED", finishedAt, error: null });
    expect(f.lastFailureAt).toBe(finishedAt);
    expect(f.lastError).toBeNull();
    expect(f.lastStatus).toBe("ABANDONED");
  });

  it("defaults a missing kind to null", () => {
    const f = heartbeatWriteFields({ service: "s", env: "e", status: "COMPLETED", finishedAt });
    expect(f.lastKind).toBeNull();
  });
});

function prismaWith(serviceHeartbeat: Record<string, unknown>): PrismaClient {
  return { serviceHeartbeat } as unknown as PrismaClient;
}

describe("recordHeartbeat", () => {
  it("upserts on the (service, env) key, touching only the success column for a COMPLETED beat", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    await recordHeartbeat(prismaWith({ upsert }), {
      service: "shopify-read",
      env: "prod",
      status: "COMPLETED",
      finishedAt,
      kind: "INCREMENTAL",
    });

    const arg = upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ service_env: { service: "shopify-read", env: "prod" } });
    expect(arg.create).toEqual({
      service: "shopify-read",
      env: "prod",
      lastSuccessAt: finishedAt,
      lastStatus: "COMPLETED",
      lastKind: "INCREMENTAL",
    });
    expect(arg.update).toEqual({ lastSuccessAt: finishedAt, lastStatus: "COMPLETED", lastKind: "INCREMENTAL" });
    expect(arg.update.lastFailureAt).toBeUndefined(); // a success never touches the failure column
  });

  it("touches only the failure column for a FAILED beat", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    await recordHeartbeat(prismaWith({ upsert }), {
      service: "s",
      env: "e",
      status: "FAILED",
      finishedAt,
      error: "boom",
    });

    const arg = upsert.mock.calls[0][0];
    expect(arg.update).toEqual({ lastFailureAt: finishedAt, lastError: "boom", lastStatus: "FAILED", lastKind: null });
    expect(arg.update.lastSuccessAt).toBeUndefined();
  });
});

describe("createHeartbeatSink", () => {
  it("binds service/env and delegates to recordHeartbeat", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const sink = createHeartbeatSink(prismaWith({ upsert }), "shopify-read", "prod");

    await sink({ status: "FAILED", finishedAt, error: "boom", kind: "BACKFILL" });

    const arg = upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ service_env: { service: "shopify-read", env: "prod" } });
    expect(arg.update.lastFailureAt).toBe(finishedAt);
    expect(arg.update.lastError).toBe("boom");
  });
});

describe("readServiceHeartbeats", () => {
  const rowA = {
    service: "a",
    env: "prod",
    lastSuccessAt: new Date("2026-06-09T10:00:00Z"),
    lastFailureAt: new Date("2026-06-09T11:00:00Z"),
    lastError: "boom",
    lastStatus: "FAILED",
    lastKind: "INCREMENTAL",
    updatedAt: finishedAt,
  };
  const rowB = {
    service: "b",
    env: "prod",
    lastSuccessAt: new Date("2026-06-09T09:00:00Z"),
    lastFailureAt: null,
    lastError: null,
    lastStatus: "COMPLETED",
    lastKind: null,
    updatedAt: finishedAt,
  };

  it("filters by env + the requested services and maps rows to ServiceFreshness", async () => {
    const findMany = vi.fn().mockResolvedValue([rowA, rowB]);
    const map = await readServiceHeartbeats(prismaWith({ findMany }), "prod", ["a", "b", "c"]);

    expect(findMany).toHaveBeenCalledWith({ where: { env: "prod", service: { in: ["a", "b", "c"] } } });
    expect(map.get("a")).toEqual({
      lastFinishedAt: rowA.lastSuccessAt,
      latestFailure: { failedAt: rowA.lastFailureAt, error: "boom" },
    });
  });

  it("maps a row with no failure to a null latestFailure", async () => {
    const findMany = vi.fn().mockResolvedValue([rowB]);
    const map = await readServiceHeartbeats(prismaWith({ findMany }), "prod", ["b"]);
    expect(map.get("b")).toEqual({ lastFinishedAt: rowB.lastSuccessAt, latestFailure: null });
  });

  it("omits a service with no row (watchdog reads absence as 'never reported' → stale)", async () => {
    const findMany = vi.fn().mockResolvedValue([rowA]);
    const map = await readServiceHeartbeats(prismaWith({ findMany }), "prod", ["a", "ghost"]);
    expect(map.has("a")).toBe(true);
    expect(map.has("ghost")).toBe(false);
  });

  it("returns an empty map when nothing has reported", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const map = await readServiceHeartbeats(prismaWith({ findMany }), "prod", ["a"]);
    expect(map.size).toBe(0);
  });

  it("propagates a monitoring-DB error rather than swallowing it", async () => {
    const findMany = vi.fn().mockRejectedValue(new Error("monitoring db unreachable"));
    await expect(readServiceHeartbeats(prismaWith({ findMany }), "prod", ["a"])).rejects.toThrow(
      "monitoring db unreachable",
    );
  });
});
