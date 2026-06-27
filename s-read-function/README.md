# s-read-function

Pulls **orders**, **payouts**, and **balance transactions** from the Shopify Admin GraphQL
API into a dedicated Postgres database. Designed to run as an AWS Lambda on a schedule, but
every step runs locally first so the pipeline is proven before deployment.

Database, projection, and normalization logic live in the shared
[`@inventory/s-ingest-core`](../packages/s-ingest-core) package (which owns the Prisma
schema + migrations); this package holds the Shopify-API-facing read path. The
companion [`s-replay-function`](../s-replay-function) handles admin replay / watermark
operations over the same core.

## How it works

```
EventBridge (cron)  ─▶  handler  ─┬─ incremental sync (orders + payouts, updated_at cursor)
                                   └─ backfill (Bulk Operation lifecycle, from cutover date)
                                            │
   Shopify Admin GraphQL  ──fetch──▶  shopify_raw_event   (append-only log, never mutated)
                                            │  (separate, replayable step)
                                   loader / projection  ──upsert by GID──▶  shop_* live tables
```

- **`shopify_raw_event`** is an append-only diagnosis log. Every row records how it
  arrived via the `source` column (`BACKFILL` / `INCREMENTAL` / `HAND_LOADED` /
  `TEST_LOADED`), so synthetic rows stay distinguishable from real API data forever.
- **Live tables** (`shop_order`, `shop_order_line`, `shop_refund`, `shop_payout`,
  `shop_balance_transaction`) are keyed on **`(store_id, Shopify GID)`** and written
  with idempotent upserts — re-reading the API or re-injecting an event never
  duplicates. The `store_id` is part of the key because a Shopify GID is unique only
  within a shop, so multi-store is additive (no key migration needed). This upsert keying is
  what makes the pipeline **at-least-once-safe**: a re-invoke after a crash, or a replay,
  re-projects the same nodes and converges (the only non-idempotent hop in the fleet is the
  monitoring relay's SNS publish).
- Payout ↔ order association is a stored column on each balance transaction
  (`payout_gid` + `order_gid`), not a heuristic. All cents are **signed**, so refunds
  and negative adjustments within a payout need no special handling. The incremental
  balance-transaction pull filters on `processed_at` — verified (2025-07) to be the same
  instant as the node's `transactionDate`, which is the field the watermark advances on, so
  the filter axis matches the watermark axis (no skips, no full re-pull).

## Where to put credentials

### Local development
Copy `.env.example` to `.env` (git-ignored) and fill it in:

| Variable | What it is |
| --- | --- |
| `SHOPIFY_READ_DATABASE_URL` | Connection string for a **local Postgres**. |
| `SHOPIFY_SHOP` | `your-store.myshopify.com`. |
| `SHOPIFY_ADMIN_TOKEN` | Admin API access token (`shpat_...`). |
| `SHOPIFY_API_VERSION` | API version to pin, e.g. `2025-07`. |
| `STORE_ID` | Seed used **only** by offline `inject` (defaults to `SHOPIFY_SHOP`). Real syncs ignore it and derive `store_id` from the live store's `myshopifyDomain` (recorded in the `store` registry table); a mismatch is logged as a warning. |
| `CUTOVER_DATE` | ISO date — backfill starts here and moves forward. |

**Required Admin API scopes:**
- `read_orders` — orders, line items, money, refunds.
- `read_customers` — buyer email/name on orders.
- `read_shopify_payments_accounts` — access the `shopifyPaymentsAccount` object.
- `read_shopify_payments_payouts` — the `payouts` + `balanceTransactions` connections.

(The legacy umbrella `read_shopify_payments` has been split into the two granular
`read_shopify_payments_*` scopes above — you need both.) Add these to the app,
**release a new version**, and **install/update** it on the store for the scopes to
take effect.

**Getting the token (new Dev Dashboard apps).** Shopify has removed the legacy
"Develop apps → reveal Admin API access token" flow for many stores. Apps created in
the **Dev Dashboard** instead expose a **Client ID** and **Client Secret** (in the
app's **Settings** in the Dev Dashboard on Shopify), which you exchange for a
short-lived (~24h) Admin API access token via the client-credentials grant:

```bash
curl -X POST "https://<shop>.myshopify.com/admin/oauth/access_token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=<id>&client_secret=<secret>"
```

The response's `access_token` (an `shpat_…` value) goes into `SHOPIFY_ADMIN_TOKEN`.
Because it expires in ~24h, it's fine for local testing but for the deployed Lambda
you'll want to fetch it programmatically each run from the client id/secret (a small
addition to `shopify/client.ts`) rather than storing a static token. The client id
and secret live in the app's Settings in the Dev Dashboard — never commit them or
`.env`.

> Legacy custom apps (stores that still offer "Develop apps" in the admin) instead
> show a static Admin API access token you can reveal once and paste into `.env`.

### Production (Lambda — wiring deferred)
The same variable names are read from `process.env`. In Lambda, inject them from
**AWS Secrets Manager / SSM Parameter Store** (e.g. via the Secrets Manager Lambda
extension or environment mapping) — the code does not read AWS APIs directly, it
only reads `process.env`. Route `SHOPIFY_READ_DATABASE_URL` through **RDS Proxy / pgBouncer**
with `?pgbouncer=true&connection_limit=1` for connection pooling across warm
invocations. No secret is ever committed to the repo.

## Setup

```bash
npm install                                  # from the repo root (workspaces)
npm run db:generate -w @inventory/s-ingest-core   # generate the Prisma client
npm run db:deploy   -w @inventory/s-ingest-core   # apply migrations to the DB (uses core/.env)
```

The schema, migrations, and Prisma client are owned by `@inventory/s-ingest-core` — this
package consumes the generated client. See [FUTUREWORK.md](FUTUREWORK.md) for how
migrations are applied in deployment.

## Triggers

All run locally with no AWS dependency (they read `.env`):

```bash
npm run sync:incremental     # delta pull (orders + payouts) since the last watermark
npm run sync:backfill        # Bulk Operation backfill from CUTOVER_DATE forward
npm run inject -- <fixture.json> [--test]   # load a hand-authored/fixture node
```

`inject` validates the node with the same Zod schema the API path uses, appends it
to `shopify_raw_event` tagged `HAND_LOADED` (or `TEST_LOADED` with `--test`), then
runs the loader so it flows into the live tables exactly like real data. This is
also how batch/test infrastructure seeds matching raw events. A fixture file looks
like:

```json
{ "objectType": "PAYOUT", "node": { "id": "gid://shopify/ShopifyPaymentsPayout/1", "...": "..." } }
```

In Lambda, `handler.ts` routes an EventBridge event to the same `incremental` or
`backfill` orchestrator based on the event payload.

## Tests

```bash
npm test
```

Covers raw→live projection idempotency, signed/negative balance transactions,
order status transitions (cancellation/refund), and watermark advancement.

## Operations & monitoring

> Full design (signals, tiered CloudWatch-backstop + DB-enrichment, watchdog/outbox/relay,
> fleet strategy, pricing): [MONITORING-PRD.md](MONITORING-PRD.md).


- **Lambda reserved concurrency = 1 (deployment requirement).** The sync must never
  run concurrently with itself — overlapping runs waste API budget and can contend on
  the same rows. Reserved concurrency = 1 enforces this. It also makes the stale-run
  reaper unambiguous (any `RUNNING` row at startup is then guaranteed dead).
- **Stale-run reaper (built in).** On startup the handler relabels `sync_run` rows
  stuck in `RUNNING` past a staleness threshold to `ABANDONED` (a process killed by
  timeout/OOM). This is cosmetic — it touches no watermark or data; the next scheduled
  run self-heals via the watermark. Nothing is auto-reprojected.
- **Primary health signal: a freshness heartbeat,** not watermark lag. Alarm on
  `now − (latest COMPLETED sync_run.finishedAt)` exceeding a couple of cron intervals.
  This advances on every successful run, including empty ones, so it does **not**
  false-fire on a quiet store. (Watermark lag — `now − sync_state.lastUpdatedAtProcessed`
  — is **not** a good primary signal: the watermark only moves when real records arrive,
  so a genuinely quiet store looks "stale." Use watermark lag only where you have an
  expected per-store activity cadence.)

## Deployment (Terraform)

When this is deployed, **Terraform provisions the infrastructure** — it does **not** run
schema migrations (those are a separate deploy-time step; see
[FUTUREWORK.md](FUTUREWORK.md)). What Terraform owns:

- **Networking:** a VPC with private subnets for RDS; the Lambdas' VPC config (subnets +
  security groups); an SG allowing the Lambdas → RDS Proxy on 5432; and a **NAT gateway**
  (or equivalent egress) so the VPC-bound read Lambda can still reach the Shopify API.
- **Database:** the dedicated **RDS PostgreSQL** instance (+ subnet/parameter groups),
  fronted by **RDS Proxy**. The runtime `SHOPIFY_READ_DATABASE_URL` routes through the proxy with
  `?pgbouncer=true&connection_limit=1`.
- **Functions:** `s-read-function` and `s-replay-function` (plus a migrate-runner — see
  FUTUREWORK), with memory/timeout, VPC config, and env wiring. **Reserved concurrency = 1
  on `s-read-function`** is required (prevents self-overlap; see Operations & monitoring).
- **IAM (least privilege):** each function's execution role gets only Secrets Manager read,
  VPC ENI, and CloudWatch Logs, plus **runtime DB creds that are DML-only (no DDL)**. A
  separate **ops role** holds `lambda:InvokeFunction` on `s-replay-function`. **No public
  endpoint** (no Function URL / API Gateway) — admin is IAM-gated invoke only.
- **Secrets:** Secrets Manager entries for the DB URL and the Shopify client id/secret.
- **Scheduling:** an **EventBridge** rule invoking `s-read-function` on the sync cadence
  (optionally a separate backfill schedule). `s-replay-function` is **not** scheduled — it
  is invoke-only.
- **Observability:** CloudWatch **log groups with retention set** (Lambda's default never
  expires), the alarms from [MONITORING-PRD.md](MONITORING-PRD.md), and the SNS alert topic.

## Status / future work

See [FUTUREWORK.md](FUTUREWORK.md) for deferred items: poison-record skip-and-flag DLQ and
programmatic token acquisition. (Replay / reset-watermark / reingest-bulk admin operations
and the stale-run reaper are **built** — see [`s-replay-function`](../s-replay-function) and
the stale-run reaper above.)

- Deployment infra (EventBridge schedule, RDS Proxy, packaging) is **not** wired yet.
- Cross-database de-duplication against `income-app` is **future work**; this
  function persists the identifiers income-app records (legacy order id, order name,
  payout id) so that reconciliation can be deterministic later.
- A webhook + nightly-poll hybrid is the documented end state.
