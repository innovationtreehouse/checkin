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

## 2. Secure invocation of the admin operations (deploy-time)

The operations themselves — `replay` / `reset-watermark` / `reingest-bulk`, all idempotent
via `(store_id, GID)` upserts + the append-only log — are **built** in
[`s-replay-function`](../s-replay-function). What's still deferred is the deployment security
model for invoking them.

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

## 3. Monitoring — alarm wiring

The stale-run reaper (`reapStaleRuns`, called at handler startup) and reserved-concurrency
= 1 are **done** (README "Operations & monitoring"). What remains is wiring the alarms in
deployment: emit both the freshness heartbeat and watermark lag as CloudWatch metrics,
alarm on the **heartbeat** (not watermark lag). Full design — including why heartbeat over
watermark lag — in [MONITORING-PRD.md](MONITORING-PRD.md) §4.1. No auto-reprojection; a dead
run self-heals on the next scheduled run.

---

## 4. Schema migrations in deployment — realized in [DEPLOY.md](DEPLOY.md)

The design (now shipped as the s-read migrate task): `s-ingest-core` owns `schema.prisma` +
migrations; **applying** them is a separate step, **not** Terraform and **not** the app
functions.

- **Terraform** provisions the RDS instance and a **migrate-runner** (holding DDL creds) but
  does **not** run the migration — mixing declarative reconciliation with an ordered schema
  sequence is an anti-pattern (avoid the `null_resource` + `local-exec "prisma migrate
  deploy"` hack). It *creates the thing that can migrate*.
- **CI/CD** runs `prisma migrate deploy` via the migrate-runner **before** releasing code
  that expects the new schema; use **expand/contract** ordering so a rolling deploy never
  runs code ahead of its schema.
- **App functions** (`s-read`, `s-replay`) run **DML-only** and never migrate; only the
  migrate-runner has DDL. **Locally:** by hand — `npm run db:deploy` from `s-ingest-core`.

## 5. Token acquisition for deployed Lambda — done (#237)
`shopify/client.ts` (`shopify/token.ts`) mints the short-lived (~24h) Admin token from
`SHOPIFY_CLIENT_ID` + `SHOPIFY_CLIENT_SECRET` via the client-credentials grant, caching it
in memory across warm invocations; `SHOPIFY_ADMIN_TOKEN` remains the local/legacy static
path (static-token precedence). No refresh-token / encrypted-DB layer — the grant issues
none. Full behaviour: README "Getting the token".
