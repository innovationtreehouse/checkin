/**
 * Outbox read/ack helpers — used by the relay to deliver alerts.
 *
 * Delivery is idempotent and retried: the relay claims PENDING rows, publishes each to
 * SNS, and marks it SENT only after a successful publish. A failed publish records the
 * attempt; the row stays PENDING for the next run to retry UNLESS the failure is permanent
 * or it has exhausted its attempt budget, in which case it is parked in the DEAD
 * dead-letter state. DEAD rows are never re-claimed, so a single undeliverable ("poison")
 * row cannot wedge the oldest-first drain. The relay reports itself unhealthy while any
 * DEAD rows exist (see `countDead`); an operator recovers them with `requeueDead` once the
 * root cause is fixed. The health_event preserves the incident regardless.
 */
import type { PrismaClient } from "./generated/prisma/client.js";
import { OutboxStatus } from "./generated/prisma/client.js";

export interface PendingAlert {
  id: bigint;
  /** The health_event this alert was raised from — the stable incident id surfaced on SNS. */
  healthEventId: bigint;
  service: string;
  env: string;
  severity: string;
  subject: string;
  summary: string;
  /** Correlation id shared with the health_event / metric / logs, surfaced on SNS. */
  correlationId: string | null;
  attempts: number;
}

/** Oldest-first batch of undelivered alerts. DEAD rows are excluded by the PENDING filter. */
export async function claimPending(prisma: PrismaClient, limit = 50): Promise<PendingAlert[]> {
  const rows = await prisma.outbox.findMany({
    where: { status: OutboxStatus.PENDING },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  return rows.map((r) => ({
    id: r.id,
    healthEventId: r.healthEventId,
    service: r.service,
    env: r.env,
    severity: r.severity,
    subject: r.subject,
    summary: r.summary,
    correlationId: r.correlationId,
    attempts: r.attempts,
  }));
}

/** Mark an alert delivered. */
export async function markSent(prisma: PrismaClient, id: bigint): Promise<void> {
  await prisma.outbox.update({
    where: { id },
    data: { status: OutboxStatus.SENT, sentAt: new Date() },
  });
}

/** Verdict for a failed delivery — drives whether the row retries or is dead-lettered. */
export interface FailureVerdict {
  /** The row's CURRENT attempt count (PendingAlert.attempts), before this failure. */
  attempts: number;
  /** Park in DEAD once this failure makes the count reach the budget. */
  maxAttempts: number;
  /** Permanent failure (malformed payload, auth, missing topic): dead-letter immediately. */
  permanent: boolean;
}

/**
 * Record a failed delivery attempt. The row stays PENDING for the next run to retry, UNLESS
 * the failure is permanent or this attempt exhausts `maxAttempts` — then it is moved to DEAD
 * (dead-letter) so it can never re-enter the drain. The status decision and the attempt
 * increment happen in a single update.
 */
export async function markFailed(
  prisma: PrismaClient,
  id: bigint,
  error: string,
  verdict: FailureVerdict,
): Promise<void> {
  const dead = verdict.permanent || verdict.attempts + 1 >= verdict.maxAttempts;
  await prisma.outbox.update({
    where: { id },
    data: {
      attempts: { increment: 1 },
      lastError: error.slice(0, 1000),
      ...(dead ? { status: OutboxStatus.DEAD, deadAt: new Date() } : {}),
    },
  });
}

/** How many alerts are currently dead-lettered for this env. Non-zero ⇒ relay is unhealthy. */
export async function countDead(prisma: PrismaClient, env: string): Promise<number> {
  return prisma.outbox.count({ where: { status: OutboxStatus.DEAD, env } });
}

/**
 * Operator recovery: move dead-lettered rows back to PENDING (attempts reset) so the next
 * relay run retries them — use after fixing the root cause. Scoped to one env; pass an `id`
 * to requeue a single row. Returns how many rows were requeued.
 */
export async function requeueDead(
  prisma: PrismaClient,
  env: string,
  opts: { id?: bigint } = {},
): Promise<number> {
  const result = await prisma.outbox.updateMany({
    where: { status: OutboxStatus.DEAD, env, ...(opts.id !== undefined ? { id: opts.id } : {}) },
    data: { status: OutboxStatus.PENDING, attempts: 0, deadAt: null, lastError: null },
  });
  return result.count;
}
