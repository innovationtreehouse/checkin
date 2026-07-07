# s-read deployment runbook

Go-live checklist for the s-read sync as a **scheduled ECS task** (infra:
innovationtreehouse/infra#112 — its PR body is the authoritative resource
contract; app chain: checkin#940 → infra#112 → this). Region `us-east-2`,
account `639595353568`. Work through it **in order** — each step assumes the
previous ones are done.

How the pieces fit:

```
Schedule (hourly) ─▶ Lambda s-read-trigger  ({"mode":"incremental"|"backfill"}; not
   │                 VPC-attached; also the hook for future event sources)
   └─▶ ecs:RunTask on the revision-less s-read-sync FAMILY (= latest ACTIVE revision)
          └─▶ ECS task s-read-sync — image CMD runs `src/cli.ts` in ${SYNC_MODE:-incremental} mode
Deploy workflow (.github/workflows/deploy-s-read.yml, manual dispatch from main)
   └─▶ build+push image to ghcr.io → register migrate revision → (run migrate task,
       wait for exit 0) → register sync revision
Backfill / manual sync = `aws lambda invoke` on s-read-trigger with the mode payload
Migrate task = raw run-task from the workflow only (deliberately NOT invocable via the trigger)
```

The image lives at **`ghcr.io/innovationtreehouse/s-read`** (pushed by the
workflow with the GITHUB_TOKEN, tagged `:<git-sha>`) and stays **private**: the
task defs pull it via `repositoryCredentials` → the shared ghcr-pull-credentials
secret (infra `modules/shared-iam`), same as every other ECS workload in this
account — no make-public step, no per-service pull PAT.

## 1. Shopify app: scopes, release, install

The app (Dev Dashboard) needs the four scopes from [README](README.md#where-to-put-credentials):
`read_orders`, `read_customers`, `read_shopify_payments_accounts`,
`read_shopify_payments_payouts` (the legacy umbrella `read_shopify_payments` is
split — you need both `_accounts` and `_payouts`).

Add the scopes, **release a new app version**, and **install/update it on the
store** — scopes don't take effect until the store accepts the new version. Note
the app's **Client ID** and **Client Secret** (app Settings) for step 3.

## 2. Infra applied + database bootstrap

1. infra#112 `terraform apply`d (cluster `s-read`, task-def families
   `s-read-sync`/`s-read-migrate` with the ghcr `repositoryCredentials`, the
   `s-read-trigger` Lambda + hourly schedule, secret shells, IAM,
   `s-read-compute` SG).
2. Run `modules/s-read/init.sql` **by hand** against the shared Aurora cluster's
   master user (creates the `shopify_read` database + the `s_read_ddl` /
   `s_read_dml` roles — Terraform cannot `CREATE DATABASE`). Cluster is
   Serverless v2 with auto-pause: the first connection can take ~30s to wake it.

## 3. Secret values (4)

Shells exist after step 2; set the values out-of-band:

```bash
aws secretsmanager put-secret-value --secret-id s-read/database-url     --secret-string 'postgresql://s_read_dml:...@.../shopify_read'
aws secretsmanager put-secret-value --secret-id s-read/database-url-ddl --secret-string 'postgresql://s_read_ddl:...@.../shopify_read'
aws secretsmanager put-secret-value --secret-id s-read/shopify-client-id     --secret-string '...'
aws secretsmanager put-secret-value --secret-id s-read/shopify-client-secret --secret-string '...'
```

ECS injects these natively via the task definitions' `secrets` blocks as
`SHOPIFY_READ_DATABASE_URL` (DML for the sync task, DDL for the migrate task),
`SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET` — the code reads only `process.env`
(no AWS SDK calls; see [README "Where to put credentials"](README.md#where-to-put-credentials)).
The migrate task runs `npm run db:deploy -w @inventory/s-ingest-core`, which is
container-safe: prisma resolves the URL from `process.env`; a package-local
`.env` is optional (local-dev convenience via `prisma.config.ts`'s dotenv import).

## 4. Terraform variables

- `cutover_date` → becomes the task's `CUTOVER_DATE` env var: the ISO date the
  backfill starts from (and the boundary income-app hands off at). Choose it
  deliberately; changing it later does not re-run a completed backfill.
- `shopify_shop` → `SHOPIFY_SHOP`.

Set both (they're `TODO` placeholders in `live/mgmt/main.tf`), `terraform apply`.

## 5. First deploy (workflow, `migrate-and-code`)

One-time prep: set the repo variable `S_READ_NETWORK_CONFIG` (Settings →
Variables) to the run-task network JSON — SG id from the infra output
`s_read_compute_sg_id`, subnets are the three default-VPC public ones:

```json
{"awsvpcConfiguration":{"subnets":["subnet-0597513f1c0c3173e","subnet-0a67d72908bffbcd4","subnet-0c84ac2840be3a2bc"],"securityGroups":["sg-..."],"assignPublicIp":"ENABLED"}}
```

Then run **Actions → "Deploy s-read" → Run workflow** (from `main` — the OIDC
role's trust is pinned to `refs/heads/main`) with mode **migrate-and-code**.
It builds/pushes the image, runs the migrate task (waits for exit 0), then
registers the new `s-read-sync` revision. From that moment the hourly schedule
runs real syncs.

## 6. One-time backfill

The backfill is a **Bulk Operation lifecycle**: the first run submits the export
and returns (`action: "STARTED"`); later runs poll and, once Shopify completes
it, download + ingest (`action: "INGESTED"`). Payouts/balance transactions
backfill inline on each run. Re-run until you've seen `INGESTED` (afterwards it
reports `NONE`). Invoke through the trigger Lambda (it RunTasks the sync family
with the right `SYNC_MODE` override — this is also how a manual incremental sync
is kicked, with `"mode":"incremental"`):

```bash
aws lambda invoke --function-name s-read-trigger \
  --cli-binary-format raw-in-base64-out \
  --payload '{"mode":"backfill"}' out.json && cat out.json
```

Fallback if the trigger Lambda is unavailable — the raw run-task it performs:

```bash
aws ecs run-task \
  --cluster s-read \
  --task-definition s-read-sync \
  --launch-type FARGATE \
  --network-configuration "$S_READ_NETWORK_CONFIG" \
  --overrides '{"containerOverrides":[{"name":"s-read-sync","environment":[{"name":"SYNC_MODE","value":"backfill"}]}]}'
```

(Verified against the image: the container CMD runs
`src/cli.ts ${SYNC_MODE:-incremental}`, and cli.ts's `backfill` command calls
`handler({ mode: "backfill" })`.) The run lock makes an overlap with the hourly
incremental resolve cleanly (one of them skips). The **migrate** task is
deliberately NOT invocable through the trigger — it runs only as a raw run-task
from the deploy workflow.

## 7. Verify

- **Logs**: CloudWatch log group `/ecs/s-read-sync` — the backfill run logs
  `backfill step done` with counts; incremental runs log `incremental sync done`.
  Migrate task logs land in `/ecs/s-read-migrate`.
- **Rows**: against `shopify_read` (DML role):

  ```sql
  SELECT source, count(*) FROM shopify_raw_event GROUP BY source;  -- BACKFILL + INCREMENTAL rows
  SELECT count(*) FROM shop_order;                                  -- projected orders > 0
  ```

- **Freshness**: `SELECT max(finished_at) FROM sync_run WHERE status = 'COMPLETED';`
  should advance every hour.

## Day-2

- **Code-only change**: run the workflow with mode `code-only` (skips the migrate
  task run; both task-def families still get new revisions).
- **Schema change**: mode `migrate-and-code` — migrations always run **before**
  the new sync revision is registered, so write them expand/contract (the old
  revision keeps running against the new schema until the next tick).
- **Rollback**: re-run the workflow from the last good commit (`code-only`), or
  register a task-def revision pointing at the previous image tag by hand.
