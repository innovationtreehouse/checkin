# Future work

Items intentionally deferred. None are required for the current single-store,
manually-operated setup; each is a clean **additive** change when the system grows
or starts running unattended. Recorded here so the design decisions aren't lost.

---

## 1. Skip-and-flag projection DLQ (poison-record isolation)

**Problem.** Today a node that *deterministically* fails projection (e.g. a malformed
money value, an unexpected null) makes `ingestNode` rethrow, which aborts the stream
and stops the watermark from advancing past it. One bad record wedges that object
type until a human intervenes. Data is never lost — it's durable in
`shopify_raw_event` — but ingestion for that object type stalls.

**Change.**
- Add to `shopify_raw_event`: `projection_status` (`OK` | `ERRORED`, default `OK`),
  `projection_error` (text), `projection_attempts` (int).
- In `ingestNode`, wrap projection: on failure, increment `attempts`; after N attempts
  (e.g. 3, to ride out transient DB blips like a deadlock) mark the row `ERRORED`,
  log, and **do not rethrow** — let the stream continue so the watermark advances past
  the poison record.
- The append-only raw log *is* the dead-letter store. There is no separate queue and
  no data to "resubmit" — recovery is re-projection (see §2).

**Recover.** `replay --errored` re-projects flagged rows after a code fix; clears the
status on success. No UI: the errored state is a flag on rows you already have, and the
fix is almost always a code change + batch replay, never per-record hand-editing.

**Trade-off — don't do this until it's warranted.**
- *Halt-on-error (today):* one bad record freezes the object type, but the failure is
  loud and impossible to ignore — a good built-in alarm when there's no monitoring.
  Defensible for a low-volume single store.
- *Skip-and-flag:* keeps ingestion flowing and isolates the bad record, but introduces
  a **monitoring dependency** — if nobody watches the errored count, bad records pile up
  silently. Only adopt this once the system runs unattended **and** there's an alarm on
  `projection_status = ERRORED` count > 0.

---

## 2. Replay / reset-watermark as admin operations

Two recovery primitives, both **idempotent** (safe to run repeatedly) thanks to
`(store_id, GID)` upserts + the append-only log:

- **`replay`** — re-project raw events from the log (`--errored` / `--gid` /
  `--since --object`). No Shopify calls. Fully safe.
- **`reset-watermark`** — move or clear `sync_state` so the next sync re-pulls a range
  from Shopify. Not data-destructive (re-pull is idempotent), but operationally
  significant — it costs API budget and time.

Both are the *same idea* — replay over a range — one from the log, one from the source.
Expose as CLI commands and/or as handler modes (`{"mode":"replay", ...}`). Neither needs
a UI; for a read pipeline, a CloudWatch alarm + a `list-errors` query is the whole
operator surface.

### Secure invocation (the important part)

**A Lambda has no public surface by default.** `aws lambda invoke` and EventBridge hit
the AWS control plane, authenticated by **IAM (SigV4)** — there is no open HTTP endpoint.
Random internet actors cannot reach it. "Anyone can POST JSON" only becomes true if you
attach a **Function URL with `AuthType: NONE`** or an unauthenticated API Gateway — so
**don't.** Keep the admin modes invocation-only.

Layered model (defense in depth):

- **Layer 0 — no HTTP trigger.** Sync runs from EventBridge (cron); admin runs from
  `aws lambda invoke` under an IAM identity. Neither is internet-facing. This alone
  closes the "anyone can hit it" question.
- **Layer 1 — least-privilege IAM.** Grant `lambda:InvokeFunction` on this function only
  to a specific ops role/user (one you assume for admin work), never `*`. The function's
  execution role gets only RDS Proxy + Secrets Manager read.
- **Layer 2 — separate the dangerous modes.** Preferred: a distinct **admin Lambda** for
  `replay` / `reset-watermark`, with a resource policy locked to the ops role; the cron
  can invoke only the *sync* Lambda. (Or keep one Lambda and rely on function-level IAM —
  simpler, coarser.)
- **Layer 3 — payload defense in depth.** Require an `adminToken` in the event, validated
  **constant-time** against a Secrets Manager value before any action; require an explicit
  `storeId` + `confirm: true`; default to the narrowest scope (no "reset everything").
  This guards against accidental or mis-targeted invokes even by an authorized caller.
  IAM is the real gate; this is the seatbelt.
- **Layer 4 — audit.** CloudTrail records every invoke (who/when). Each admin action also
  writes a `sync_run` row (kind `ADMIN`) capturing mode, args, and result.

**If a public HTTP endpoint is ever genuinely required:** use a **Lambda Function URL
with `AuthType: AWS_IAM`** (caller SigV4-signs) or **API Gateway with IAM / a Lambda
authorizer / Cognito**, fronted by **WAF**. Never `AuthType: NONE`.

### Local CLI pointed at prod
For a small system, running the CLI locally with `SHOPIFY_READ_DATABASE_URL` = prod (through RDS Proxy)
is acceptable and pragmatic. Security there is about *who holds the prod credentials*:
keep them in Secrets Manager, grant the ops role read access, prefer assuming a role over
static keys, and lean on the operations being idempotent. The `aws lambda invoke` route is
strictly better (no human-on-prod-creds, reuses the deployed network path) but heavier to
set up.

---

## 3. Monitoring (the reaper itself is now built in)

> Full monitoring/alerting design is in [MONITORING-PRD.md](MONITORING-PRD.md). Summary below.


The stale-run reaper (`reapStaleRuns`, called at handler startup) and the
reserved-concurrency = 1 requirement are **done** — see the README "Operations &
monitoring" section. What remains is wiring the actual alarms in deployment:

- **Primary: freshness heartbeat.** Alarm on `now − (latest COMPLETED
  sync_run.finishedAt)` exceeding a couple of cron intervals. Advances on every
  successful run including empty ones, so it does not false-fire on a quiet store. This
  is the signal that catches "job stopped / keeps dying."
- **Do NOT make watermark lag the primary alarm.** `now − sync_state.lastUpdatedAtProcessed`
  only moves when real records arrive, so a genuinely quiet store reads as "stale." Use
  it only as a secondary, per-store signal where there's a known activity cadence.
- Emit both as CloudWatch metrics; alarm on the heartbeat. No auto-reprojection — a dead
  run needs no data recovery; the next scheduled run catches up via the watermark.

---

## 4. Schema migrations in deployment

The core package (`s-ingest-core`) owns `schema.prisma`, the migration files, and
`prisma generate`. **Applying** migrations to a deployed database is a separate,
deliberate step — **not** Terraform, and **not** the app Lambdas:

- **Terraform** provisions the RDS instance, the Lambdas, and a **migrate-runner** — a
  CodeBuild project / one-off Fargate task / dedicated migrate Lambda **inside the VPC**,
  holding DDL credentials. Terraform does **not** run the migration itself: mixing
  declarative infra reconciliation with an ordered, stateful schema sequence is an
  anti-pattern (avoid the `null_resource` + `local-exec "prisma migrate deploy"` hack —
  not idempotent in Terraform's model, runs whatever's on the runner, poor error handling).
  Terraform *creates the thing that can migrate*; it doesn't migrate.
- **CI/CD** invokes the migrate-runner to `prisma migrate deploy` **before** releasing the
  function code that expects the new schema. Use **expand/contract** ordering (add a column
  before code reads it; drop it only after code stops) so a rolling deploy never runs code
  ahead of its schema.
- **App Lambdas** (`s-read`, `s-replay`) run with **DML-only** runtime creds and never
  migrate. Only the migrate-runner has DDL rights. Exactly one actor applies migrations,
  never at runtime.
- **Locally (today):** migrations are applied by hand — `npm run db:deploy` from
  `s-ingest-core`, pointed at the dev DB.

## 5. Token acquisition for deployed Lambda — done (#237)
Dev Dashboard apps issue a short-lived (~24h) Admin API token via the client-credentials
grant (see README "Getting the token"). `shopify/client.ts` now mints it programmatically
from `SHOPIFY_CLIENT_ID` + `SHOPIFY_CLIENT_SECRET` (`shopify/token.ts`) instead of
requiring a hand-pasted static `SHOPIFY_ADMIN_TOKEN`, caches it in memory across warm
invocations (refreshing a few minutes before expiry), and invalidates + re-mints once on
a 401 mid-run. `SHOPIFY_ADMIN_TOKEN` still works unchanged as the local-dev/legacy path
(static-token precedence). No refresh-token / encrypted-DB layer: the client-credentials
grant issues none, so renewing is just re-running the exchange — confirmed against the
issue thread, which corrected the original refresh-token diagram.
