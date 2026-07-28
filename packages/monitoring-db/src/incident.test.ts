/**
 * Unit tests for recordIncident — the transactional outbox + renotify suppression logic.
 *
 * These drive the decision logic with a fake `$transaction`/tx so no DB is required: we
 * assert WHAT recordIncident writes and WHEN it suppresses. The atomic commit/rollback
 * semantics that only a real Postgres can prove live in test/integration/incident.test.ts.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { recordIncident } from "./incident.js";
import { IncidentKind, Severity } from "./generated/prisma/client.js";
import type { PrismaClient } from "./generated/prisma/client.js";

/** A fake interactive transaction whose three queries return canned rows. */
function makeTx(opts: { recentAlert?: { id: bigint } | null; healthEventId?: bigint; outboxId?: bigint } = {}) {
  const findFirst = vi.fn().mockResolvedValue(opts.recentAlert ?? null);
  const healthCreate = vi.fn().mockResolvedValue({ id: opts.healthEventId ?? 100n });
  const outboxCreate = vi.fn().mockResolvedValue({ id: opts.outboxId ?? 200n });
  const tx = {
    outbox: { findFirst, create: outboxCreate },
    healthEvent: { create: healthCreate },
  };
  return { tx, findFirst, healthCreate, outboxCreate };
}

/** A PrismaClient whose `$transaction` simply runs the callback against the fake tx. */
function makePrisma(tx: unknown): PrismaClient {
  return { $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx)) } as unknown as PrismaClient;
}

const base = {
  service: "shopify-read",
  env: "prod",
  kind: IncidentKind.STALE,
  detail: { correlationId: "c1" },
  subject: "subj",
  summary: "body",
};

afterEach(() => vi.useRealTimers());

describe("recordIncident", () => {
  it("enqueues an alert and appends the health_event when no renotify window is set (positive)", async () => {
    const { tx, findFirst, healthCreate, outboxCreate } = makeTx();
    const res = await recordIncident(makePrisma(tx), { ...base });

    expect(findFirst).not.toHaveBeenCalled(); // no window => no dedup lookup
    expect(healthCreate).toHaveBeenCalledOnce();
    expect(outboxCreate).toHaveBeenCalledOnce();
    expect(res).toEqual({ healthEventId: 100n, outboxId: 200n, suppressed: false });
  });

  it("suppresses the outbox alert but STILL appends the health_event when a prior alert is in-window (negative)", async () => {
    const { tx, findFirst, healthCreate, outboxCreate } = makeTx({ recentAlert: { id: 9n } });
    const res = await recordIncident(makePrisma(tx), { ...base, renotifyAfterSeconds: 300 });

    expect(findFirst).toHaveBeenCalledOnce();
    expect(healthCreate).toHaveBeenCalledOnce(); // append-only history is never suppressed
    expect(outboxCreate).not.toHaveBeenCalled();
    expect(res).toEqual({ healthEventId: 100n, outboxId: null, suppressed: true });
    // The dedup lookup must happen BEFORE this tick's health_event is appended, so the
    // window only sees PRIOR detections (the comment's invariant).
    expect(findFirst.mock.invocationCallOrder[0]).toBeLessThan(healthCreate.mock.invocationCallOrder[0]);
  });

  it("enqueues when a window is set but no prior alert exists", async () => {
    const { tx, findFirst, outboxCreate } = makeTx({ recentAlert: null });
    const res = await recordIncident(makePrisma(tx), { ...base, renotifyAfterSeconds: 300 });

    expect(findFirst).toHaveBeenCalledOnce();
    expect(outboxCreate).toHaveBeenCalledOnce();
    expect(res.suppressed).toBe(false);
  });

  it("skips the dedup lookup entirely when renotifyAfterSeconds is 0", async () => {
    const { tx, findFirst, outboxCreate } = makeTx();
    await recordIncident(makePrisma(tx), { ...base, renotifyAfterSeconds: 0 });

    expect(findFirst).not.toHaveBeenCalled();
    expect(outboxCreate).toHaveBeenCalledOnce();
  });

  it("scopes the lookback to this (service, env, kind) and the correct time window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T00:00:00Z"));
    const { tx, findFirst } = makeTx({ recentAlert: null });

    await recordIncident(makePrisma(tx), { ...base, renotifyAfterSeconds: 300 });

    expect(findFirst.mock.calls[0][0].where).toEqual({
      service: "shopify-read",
      env: "prod",
      healthEvent: { is: { kind: IncidentKind.STALE } },
      createdAt: { gte: new Date("2026-06-09T23:55:00Z") }, // now - 300s
    });
  });

  it("defaults severity to WARNING on both rows and correlationId to null", async () => {
    const { tx, healthCreate, outboxCreate } = makeTx();
    await recordIncident(makePrisma(tx), { ...base });

    expect(healthCreate.mock.calls[0][0].data).toMatchObject({
      service: "shopify-read",
      env: "prod",
      kind: IncidentKind.STALE,
      severity: Severity.WARNING,
      detail: base.detail,
    });
    expect(outboxCreate.mock.calls[0][0].data).toMatchObject({
      healthEventId: 100n,
      severity: Severity.WARNING,
      subject: "subj",
      summary: "body",
      correlationId: null,
    });
  });

  it("propagates an explicit CRITICAL severity and correlationId to both rows", async () => {
    const { tx, healthCreate, outboxCreate } = makeTx();
    await recordIncident(makePrisma(tx), { ...base, severity: Severity.CRITICAL, correlationId: "abc" });

    expect(healthCreate.mock.calls[0][0].data.severity).toBe(Severity.CRITICAL);
    expect(outboxCreate.mock.calls[0][0].data.severity).toBe(Severity.CRITICAL);
    expect(outboxCreate.mock.calls[0][0].data.correlationId).toBe("abc");
  });
});
