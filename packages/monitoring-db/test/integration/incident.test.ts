/**
 * Integration test for recordIncident against a real Postgres. Proves the things a fake
 * tx cannot: that the health_event + outbox dual-write actually commits as one unit, and
 * that the renotify suppression window behaves correctly over rows persisted by prior calls.
 * Skipped unless MONITORING_DATABASE_URL is set.
 */
import { it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { recordIncident } from "../../src/incident.js";
import { IncidentKind, OutboxStatus, Severity } from "../../src/generated/prisma/client.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { runIfDb, singleConnClient, resetTables } from "./db.js";

runIfDb("recordIncident (integration)", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = singleConnClient();
  });
  afterAll(async () => {
    await prisma?.$disconnect();
  });
  beforeEach(() => resetTables(prisma));

  const base = {
    service: "shopify-read",
    env: "prod",
    kind: IncidentKind.STALE,
    detail: { correlationId: "c1" },
    subject: "subj",
    summary: "body",
  };

  it("commits the health_event and its outbox alert atomically", async () => {
    const res = await recordIncident(prisma, { ...base, correlationId: "c1", severity: Severity.CRITICAL });

    const events = await prisma.healthEvent.findMany();
    const alerts = await prisma.outbox.findMany();
    expect(events).toHaveLength(1);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].healthEventId).toBe(events[0].id); // the outbox points at the committed event
    expect(alerts[0].status).toBe(OutboxStatus.PENDING);
    expect(alerts[0].severity).toBe(Severity.CRITICAL);
    expect(alerts[0].correlationId).toBe("c1");
    expect(res).toEqual({ healthEventId: events[0].id, outboxId: alerts[0].id, suppressed: false });
  });

  it("suppresses a duplicate alert in-window but still appends the health_event", async () => {
    const input = { ...base, renotifyAfterSeconds: 3600 };
    const first = await recordIncident(prisma, input);
    const second = await recordIncident(prisma, input);

    expect(first.suppressed).toBe(false);
    expect(second.suppressed).toBe(true);
    expect(second.outboxId).toBeNull();
    expect(await prisma.healthEvent.count()).toBe(2); // both detections recorded
    expect(await prisma.outbox.count()).toBe(1); // only one alert enqueued
  });

  it("does not suppress an alert for a different incident kind", async () => {
    const input = { ...base, renotifyAfterSeconds: 3600 };
    await recordIncident(prisma, { ...input, kind: IncidentKind.STALE });
    const other = await recordIncident(prisma, { ...input, kind: IncidentKind.ERRORING });

    expect(other.suppressed).toBe(false);
    expect(await prisma.outbox.count()).toBe(2);
  });

  it("re-alerts once the renotify window has elapsed", async () => {
    const input = { ...base, renotifyAfterSeconds: 1 };
    await recordIncident(prisma, input);
    await new Promise((r) => setTimeout(r, 1100));
    const again = await recordIncident(prisma, input);

    expect(again.suppressed).toBe(false);
    expect(await prisma.outbox.count()).toBe(2);
  });
});
