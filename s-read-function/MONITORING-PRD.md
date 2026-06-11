# Monitoring & Alerting — PRD

**Status:** Design (not yet implemented). Captures the reasoning from design review so
decisions aren't remade implicitly.
**Scope:** `s-read-function` specifically, and the broader fleet of ~50 Lambdas
this pattern is meant to generalize to.

---

## 1. Problem

These functions run unattended on a schedule (EventBridge cron). When ingestion stops —
a Lambda stops running, keeps erroring, hits its timeout, or the database is down — we
need to find out **without a human noticing data is missing days later**. The health
*data* already exists in the database (`sync_run`, `sync_state`); what's missing is a
way to get a useful signal **out** of the system and in front of an operator, reliably,
across many services, at sane cost.

## 2. Goals / Non-goals

**Goals**
- Detect "this service isn't successfully ingesting" and alert a human promptly.
- Work even when the failure is foundational (DB down, the monitor itself dead).
- Generalize to ~50 Lambdas without 50 bespoke setups.
- Keep the alert path dependency-light; keep cost predictable.

**Non-goals**
- Auto-remediation. A dead/stalled run needs no data recovery — the next scheduled run
  self-heals via the watermark (idempotent upserts + append-only raw log). Nothing is
  auto-reprojected.
- A bespoke monitoring UI. For a read pipeline, alarms + a query surface suffice.

## 3. Core principles (the load-bearing ideas)

1. **You cannot detect a failure with a signal that the failure itself suppresses.** A
   dead monitor can't emit "I'm dead." So the *floor* of the system must be **absence
   detection** in a trusted external service (CloudWatch "missing data = breaching"),
   which needs no cooperation from the thing being watched.
2. **The trust chain has to terminate somewhere** — we terminate it at **CloudWatch**
   (AWS's own monitoring plane). Everything else is enrichment layered on top.
3. **The alert headline must be self-contained.** A human must be able to act from the
   notification alone, without a DB round-trip. The DB is for *enrichment/audit*, never
   the *minimum viable alert*.
4. **Detail-richness should scale inversely with how foundational the failure is.** One
   service stale → full detail (DB is up). DB itself down → "DB is down" *is* the whole
   actionable message; no detail needed.
5. **Idempotent, append-only, self-healing** — consistent with the rest of this system.

## 4. Signal design

### 4.1 Primary signal: a freshness heartbeat (NOT watermark lag)

Alarm on **`now − (latest COMPLETED sync_run.finishedAt)`** exceeding a couple of cron
intervals. This advances on **every** successful run, including empty ones, so it does
not false-fire on a quiet store.

**Why not watermark lag.** `sync_state.lastUpdatedAtProcessed` is the `updatedAt` of the
last real *record*, and empty pulls are a no-op on it. So a genuinely quiet store (no
orders for days) reads as "stale" and would false-alarm. Watermark lag is only useful as
a **secondary, per-store** signal where there's a known activity cadence.

### 4.2 The three layers — metric vs log vs alert

A common confusion: you cannot put "which Lambda and what went wrong" *inside one metric*.

| Layer | Carries | Example |
| --- | --- | --- |
| **Metric** | a number + dimensions (no free text) | `secondsSinceLastSuccess{service=shopify-read}` = 4200 |
| **Log event** | rich free-text detail | `{"service":"shopify-read","error":"THROTTLED…","correlationId":"abc"}` |
| **Alert (SNS)** | which alarm tripped + link | "ALARM: shopify-read heartbeat > 1h → runbook" |

Every unique metric **name + dimension combination is a separate metric** (billed per
metric). A `service` dimension across 50 services = **50 metric streams**, not one — that
dimension is *how* you identify the culprit, and also the cardinality cost.

## 5. Architecture — tiered observability

Two tiers with different dependency profiles:

- **Tier 1 — CloudWatch backstop (dependency-light).** Numeric/absence signals that fire
  even when the DB is the thing that's broken.
- **Tier 2 — DB / outbox / Slack enrichment.** Rich detail, history, replay — used when
  the system is mostly healthy and you need *which* service and *why*.

### 5.1 Components

- **Watchdog** (scheduled Lambda, separate from the workers): queries the shared store
  (`max(sync_run.finishedAt)` per service) to detect stale/unhealthy services. Independent
  of the workers, so it sees a worker that's totally dead.
- **`health_event` append-only table**: durable record of every detected incident
  (same append-only-log philosophy as `shopify_raw_event`). Enables history/trend queries
  and replay of failed deliveries.
- **Outbox table**: the to-be-sent alert, written in the **same transaction** as the
  `health_event` (see §5.3).
- **Relay** (scheduled Lambda): reads unsent outbox rows, posts a self-contained summary
  to Slack/PagerDuty/email, marks them sent (idempotent, retried).

### 5.2 The three signals (this is the complete set — 3, not 2)

| Detects | Mechanism | Depends on |
| --- | --- | --- |
| A specific service is stale/unhealthy | watchdog → `health_event` + outbox → relay → Slack (rich) | DB up |
| **DB is down** while the monitor runs | watchdog/relay catches the DB error → **direct** CloudWatch metric | CloudWatch only |
| **The monitor itself isn't running** | CloudWatch **missing-data alarm** on the relay/watchdog heartbeat | CloudWatch only |

The third row is the piece a naive "two signals" design misses: a dead relay emits
nothing — including no "DB down" — so its liveness must be asserted by CloudWatch absence
detection, not by self-reporting.

### 5.3 Why detail+event must be one atomic write (Transactional Outbox)

The tempting "write to DB, then fire an event" is the classic **dual-write problem**: if
one succeeds and the other fails, you get a recorded incident nobody was told about, or a
notification pointing at a row that isn't visible yet. Fix: write the `health_event` and
the outbox row in **one transaction**; the relay delivers asynchronously from the outbox.
The event *is* a row in the same commit — never an uncoordinated second action. (This is
also the **Claim Check** pattern: store the detail, put a lightweight reference on the bus,
let the consumer enrich — but the alert summary itself stays self-contained per §3.3.)

### 5.4 Generalizations

- **Any cron component that touches the DB** emits the direct "DB unreachable" metric on
  failure — the watchdog reads `sync_run` from the DB too, so during an outage it's also
  blind and should report it.
- **Dedup the storm.** A DB outage trips everything at once (every worker looks stale +
  watchdog blind + relay blind). Group/dedup into one "DB down" page (composite alarm or
  routing rule), not 50 "service X stale" pages.

## 6. Fleet strategy (~50 Lambdas)

1. **Standardize emission.** A shared internal library so every Lambda emits health the
   same *shape*: common metric namespace + dimension keys (`service`, `env`), common
   structured-log fields. (`logger.ts` here — structured JSON + `correlationId` — is the
   seed.) "Standardize" = same schema, **not** one shared metric value. The vendor-neutral
   version is **OpenTelemetry** (instrument once, export anywhere) to avoid lock-in.
2. **One central destination.** Either (a) **CloudWatch** as the plane with alarms defined
   once as a reusable **IaC module** and templated across all functions; or (b) a
   **monitoring SaaS** (Datadog / Grafana Cloud / New Relic / Better Stack) via the
   CloudWatch integration — most teams past ~10 services move here for the single pane +
   on-call routing, trading $$ for operability.
3. **Centralized routing.** One SNS topic (or EventBridge bus) → one formatter/router →
   Slack/PagerDuty/email, with severity + dedup. Don't wire 50 functions to Slack
   individually.
4. **The "framework" is an IaC module.** Define "a monitored Lambda" once (function +
   log-group retention + standard alarms + SNS wiring) and instantiate it 50×. That's where
   consistency and cost control live.

## 7. Cost model (CloudWatch, us-east-1, ~2025 — **verify current rates**)

| Component | For | Rate |
| --- | --- | --- |
| Built-in Lambda metrics (Invocations/Errors/Duration/Throttles) | baseline health | **$0** (included) |
| Custom metric (EMF or PutMetricData) | heartbeat value | ~**$0.30**/metric/mo (first 10k) |
| `PutMetricData` API | direct push (EMF avoids) | ~**$0.01** / 1,000 reqs |
| Alarm | the trigger | ~**$0.10**/alarm/mo std (~$0.30 high-res) |
| Logs ingestion | Lambda logs | ~**$0.50**/GB after 5 GB free |
| Logs storage | retained logs | ~**$0.03**/GB/mo |
| SNS | notification fan-out | email ~free at low volume; ~$0.50–$2 per 100k–1M sends |
| EventBridge scheduled rule | watchdog/relay cron | effectively free |

**Cost reality:** the heartbeat itself is **pennies** (~1 metric + 1 alarm + free-tier
watchdog ≈ <$0.50/service/mo; <~$25/mo for heartbeats across 50 services). **The dominant
CloudWatch cost is log *ingestion volume*, not metrics/alarms** — so the fleet cost lever
is "how chatty are the logs," not "how many alarms." Set log-group retention (14–30 days)
in the IaC module from day one — Lambda's default log groups never expire.

Sources: [CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/),
[CloudZero guide](https://www.cloudzero.com/blog/cloudwatch-pricing/).

## 8. Phasing — minimal vs full

**Minimal (single service / small setup):** a **dead-man's-switch ping**. The Lambda POSTs
to a cron-monitoring service (Healthchecks.io / Dead Man's Snitch / Cronitor / Better
Stack) on each successful run; the service alerts if the ping doesn't arrive in its window.
Near-zero cost, ~20 lines, and it inverts the absence problem for you (the external service
owns the "did it run?" check). Optionally also write one `health_event` row for audit and
post a self-contained Slack message directly — no relay yet.

**Full (fleet / real on-call):** standardized emission + CloudWatch backstop alarms
(incl. missing-data on the monitor) + `health_event` log + transactional outbox + relay +
centralized routing, all defined via an IaC module. Build the outbox/relay only once the
fleet justifies guaranteed delivery, multiple channels, or replay.

Don't build the relay before the fleet needs it.

## 9. Robustness (failure-mode walk-through)

- **A worker dies mid-run** → watermark untouched; next run self-heals; stale-run reaper
  relabels the `RUNNING` row to `ABANDONED`; heartbeat goes stale → alarm. No data action.
- **A worker keeps erroring** → no COMPLETED runs → heartbeat stale → alarm.
- **DB down** → workers/watchdog/relay all blind → they emit the direct "DB unreachable"
  CloudWatch metric → one deduped page. Rich detail unavailable, but unneeded.
- **Monitor (relay/watchdog) itself dead** → emits nothing → CloudWatch missing-data alarm
  on its heartbeat fires. This is the floor.
- **Slack delivery fails** → outbox row stays unsent → relay retries; `health_event`
  preserves the incident for replay.

## 10. Open decisions

- **CloudWatch-native vs SaaS (Datadog/Grafana/etc.) vs OpenTelemetry** as the standard —
  decide **before** replicating the pattern across 50 services; retrofitting is painful.
- **Reserved concurrency = 1** is already a documented deployment requirement (prevents
  self-overlap; makes the reaper unambiguous).
- Severity tiers, escalation, on-call rotation, and **alert-fatigue** controls (grouping,
  dedup) — these matter more at fleet scale than the metric choice.
- Environment separation (dev/staging/prod) so non-prod noise doesn't page on-call.
- Metric **cardinality budget** (per-store/per-order dimensions explode metric count/cost).
- Tracing/correlation across multi-Lambda workflows (X-Ray / OTel; `correlationId` exists).
- Runbook per alarm; ownership per service.
- **Monitor the business outcome** ("orders are flowing into Postgres"), not only "the
  Lambda didn't throw."
- Security of the notification path (webhook secrets, SNS topic policies).
- Budget observability explicitly — it can rival compute cost for chatty services.

## 11. References
- Patterns: Claim Check, Transactional Outbox, Dead-man's switch / heartbeat.
- See `FUTUREWORK.md` for the related replay/reset-watermark admin operations and the
  poison-record skip-and-flag DLQ; see the README "Operations & monitoring" section for the
  reserved-concurrency requirement and the built-in stale-run reaper.
