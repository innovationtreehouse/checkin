/**
 * recordIncident — the transactional-outbox write (PRD §5.3).
 *
 * Writes the durable `health_event` row AND (unless deduplicated) its `monitoring_outbox`
 * row in ONE transaction. This is the fix for the classic dual-write problem: you never end
 * up with a recorded incident nobody was told about, or a notification pointing at a row
 * that isn't visible yet. The relay then delivers asynchronously from the outbox.
 *
 * The health_event is ALWAYS appended (it is the append-only diagnosis history). The OUTBOX
 * alert is deduplicated: when `renotifyAfterSeconds` is set and an alert for the same
 * (service, env, kind) was already enqueued within that window, no new alert is created.
 * This stops a persistent incident (e.g. a service stale across many cron ticks) from
 * re-paging every run while still recording the full detection timeline.
 */
import type { PrismaClient } from "./generated/prisma/client.js";
import { Prisma, IncidentKind, Severity } from "./generated/prisma/client.js";

export interface IncidentInput {
  /** The pipeline/service the incident is about, e.g. "shopify-read". */
  service: string;
  /** Deployment environment, e.g. "prod". */
  env: string;
  /** Why the service is unhealthy. */
  kind: IncidentKind;
  /** Defaults to WARNING; use CRITICAL for foundational failures (DB down, etc.). */
  severity?: Severity;
  /** Rich structured detail for audit/enrichment (correlationId, timestamps, errors). */
  detail: Record<string, unknown>;
  /** SNS subject line — short. */
  subject: string;
  /** SNS body — MUST be self-contained / actionable without a DB round-trip (PRD §3.3). */
  summary: string;
  /** Shared correlation id (metric/log/health_event), carried onto the alert for pivoting. */
  correlationId?: string;
  /**
   * Suppress a duplicate OUTBOX alert when one for this (service, env, kind) was enqueued
   * within this many seconds. The health_event is still appended. Omit to always alert.
   */
  renotifyAfterSeconds?: number;
}

export interface RecordedIncident {
  healthEventId: bigint;
  /** The new alert's id, or null when the alert was suppressed as a duplicate. */
  outboxId: bigint | null;
  /** True when the outbox alert was suppressed by the renotify window. */
  suppressed: boolean;
}

/**
 * Append a health_event and (unless deduplicated) enqueue its outbox alert atomically.
 */
export async function recordIncident(
  prisma: PrismaClient,
  input: IncidentInput,
): Promise<RecordedIncident> {
  const severity = input.severity ?? Severity.WARNING;
  return prisma.$transaction(async (tx) => {
    // Decide alert suppression BEFORE inserting this tick's health_event, so the lookback
    // window considers only PRIOR detections of the same (service, env, kind).
    let suppressed = false;
    if (input.renotifyAfterSeconds && input.renotifyAfterSeconds > 0) {
      const since = new Date(Date.now() - input.renotifyAfterSeconds * 1000);
      const recentAlert = await tx.outbox.findFirst({
        where: {
          service: input.service,
          env: input.env,
          healthEvent: { is: { kind: input.kind } },
          createdAt: { gte: since },
        },
        select: { id: true },
      });
      suppressed = recentAlert !== null;
    }

    const healthEvent = await tx.healthEvent.create({
      data: {
        service: input.service,
        env: input.env,
        kind: input.kind,
        severity,
        detail: input.detail as Prisma.InputJsonValue,
      },
    });

    if (suppressed) {
      return { healthEventId: healthEvent.id, outboxId: null, suppressed: true };
    }

    const outbox = await tx.outbox.create({
      data: {
        healthEventId: healthEvent.id,
        service: input.service,
        env: input.env,
        severity,
        subject: input.subject,
        summary: input.summary,
        correlationId: input.correlationId ?? null,
      },
    });
    return { healthEventId: healthEvent.id, outboxId: outbox.id, suppressed: false };
  });
}
