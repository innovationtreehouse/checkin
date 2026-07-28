/**
 * Unit tests for the outbox lifecycle helpers (relay side). These assert the query shapes
 * and field mapping with a fake Prisma client — in particular the failure-path contract
 * that markFailed leaves a row PENDING while incrementing attempts and truncating the
 * error. Real ordering/filtering against Postgres is covered in test/integration.
 */
import { describe, it, expect, vi } from "vitest";
import { claimPending, markSent, markFailed, countDead, requeueDead } from "./outbox.js";
import { OutboxStatus, Severity } from "./generated/prisma/client.js";
import type { PrismaClient } from "./generated/prisma/client.js";

function makePrisma(outbox: Record<string, unknown>): PrismaClient {
  return { outbox } as unknown as PrismaClient;
}

describe("claimPending", () => {
  const row = {
    id: 1n,
    healthEventId: 10n,
    service: "shopify-read",
    env: "prod",
    severity: Severity.WARNING,
    subject: "sub",
    summary: "sum",
    correlationId: null,
    attempts: 0,
    // extra columns the helper must drop from the returned PendingAlert:
    status: OutboxStatus.PENDING,
    lastError: null,
    createdAt: new Date("2026-06-09T00:00:00Z"),
    sentAt: null,
  };

  it("queries oldest-first, PENDING-only, with the default limit and maps to PendingAlert", async () => {
    const findMany = vi.fn().mockResolvedValue([row]);
    const res = await claimPending(makePrisma({ findMany }));

    expect(findMany).toHaveBeenCalledWith({
      where: { status: OutboxStatus.PENDING },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
    expect(res).toEqual([
      {
        id: 1n,
        healthEventId: 10n,
        service: "shopify-read",
        env: "prod",
        severity: "WARNING",
        subject: "sub",
        summary: "sum",
        correlationId: null,
        attempts: 0,
      },
    ]);
  });

  it("honors a custom limit", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await claimPending(makePrisma({ findMany }), 5);
    expect(findMany.mock.calls[0][0].take).toBe(5);
  });

  it("passes through a non-null correlationId", async () => {
    const findMany = vi.fn().mockResolvedValue([{ ...row, correlationId: "corr-1" }]);
    const [alert] = await claimPending(makePrisma({ findMany }));
    expect(alert.correlationId).toBe("corr-1");
  });
});

describe("markSent", () => {
  it("flips the row to SENT and stamps sentAt", async () => {
    const update = vi.fn().mockResolvedValue({});
    await markSent(makePrisma({ update }), 5n);

    const arg = update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 5n });
    expect(arg.data.status).toBe(OutboxStatus.SENT);
    expect(arg.data.sentAt).toBeInstanceOf(Date);
  });
});

describe("markFailed", () => {
  const transient = { attempts: 0, maxAttempts: 5, permanent: false };

  it("a transient failure below the budget increments attempts and stays PENDING for retry", async () => {
    const update = vi.fn().mockResolvedValue({});
    await markFailed(makePrisma({ update }), 7n, "boom", transient);

    const arg = update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 7n });
    expect(arg.data.attempts).toEqual({ increment: 1 });
    expect(arg.data.lastError).toBe("boom");
    expect("status" in arg.data).toBe(false); // still retryable
    expect("deadAt" in arg.data).toBe(false);
  });

  it("a permanent failure dead-letters immediately (DEAD + deadAt), regardless of attempts", async () => {
    const update = vi.fn().mockResolvedValue({});
    await markFailed(makePrisma({ update }), 7n, "InvalidParameter", { attempts: 0, maxAttempts: 5, permanent: true });

    const arg = update.mock.calls[0][0];
    expect(arg.data.status).toBe(OutboxStatus.DEAD);
    expect(arg.data.deadAt).toBeInstanceOf(Date);
    expect(arg.data.attempts).toEqual({ increment: 1 });
  });

  it("a transient failure that exhausts the budget dead-letters (attempts+1 >= maxAttempts)", async () => {
    const update = vi.fn().mockResolvedValue({});
    await markFailed(makePrisma({ update }), 7n, "throttled", { attempts: 4, maxAttempts: 5, permanent: false });

    const arg = update.mock.calls[0][0];
    expect(arg.data.status).toBe(OutboxStatus.DEAD);
    expect(arg.data.deadAt).toBeInstanceOf(Date);
  });

  it("the last retry below the budget still stays PENDING (boundary: attempts+1 < maxAttempts)", async () => {
    const update = vi.fn().mockResolvedValue({});
    await markFailed(makePrisma({ update }), 7n, "throttled", { attempts: 3, maxAttempts: 5, permanent: false });
    expect("status" in update.mock.calls[0][0].data).toBe(false);
  });

  it("truncates a long error to 1000 chars", async () => {
    const update = vi.fn().mockResolvedValue({});
    await markFailed(makePrisma({ update }), 7n, "x".repeat(1500), transient);
    expect(update.mock.calls[0][0].data.lastError).toHaveLength(1000);
  });
});

describe("countDead", () => {
  it("counts DEAD rows scoped to the env", async () => {
    const count = vi.fn().mockResolvedValue(3);
    const res = await countDead(makePrisma({ count }), "prod");
    expect(count).toHaveBeenCalledWith({ where: { status: OutboxStatus.DEAD, env: "prod" } });
    expect(res).toBe(3);
  });
});

describe("requeueDead", () => {
  it("moves all DEAD rows for an env back to PENDING and resets retry state", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const res = await requeueDead(makePrisma({ updateMany }), "prod");

    const arg = updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ status: OutboxStatus.DEAD, env: "prod" });
    expect(arg.data).toEqual({ status: OutboxStatus.PENDING, attempts: 0, deadAt: null, lastError: null });
    expect(res).toBe(2);
  });

  it("scopes to a single id when given", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    await requeueDead(makePrisma({ updateMany }), "prod", { id: 9n });
    expect(updateMany.mock.calls[0][0].where).toEqual({ status: OutboxStatus.DEAD, env: "prod", id: 9n });
  });
});
