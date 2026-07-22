# s-read sync diagnostics

**Status:** implemented (plumbing diagnostics: `/api/finance-ops/s-read/diagnose` +
system-status card). A second, data-level layer — the **match audit** — was added on
top: see the addendum at the bottom of this doc.
**Motivating pain:** the sync-status feature (#1041, #1045) sits at the end of an
eight-link chain, and today *every* broken link collapses into one of two
indistinguishable symptoms: the status line silently doesn't render, or the board
sees "sync started, but its status can't be read in this environment." Nothing on
any surface says *which* link broke, so debugging means guessing between env vars,
grants, migrations, IAM, and s-read itself.

## The chain and how each link fails today

The feature only works when all of these hold, in order. Column 3 is what the
board/operator actually sees when that link is the broken one — note how many rows
are identical.

| # | Link | Symptom today | Real distinguishing signal |
|---|------|---------------|---------------------------|
| 1 | `SHOPIFY_READ_DB` + `DATABASE_URL` set (or local `SHOPIFY_READ_DATABASE_URL` override) so `config.shopifyReadDatabaseUrl()` resolves | GET 503 → status line hidden; configHealth row red | env presence (configHealth already catches this one — the only link it covers) |
| 2 | Derived URL reaches a live Postgres (network/DNS/pause) | GET 500 → line hidden / red toast after manual sync | pg error `ETIMEDOUT`/`ENOTFOUND`/`ECONNREFUSED` |
| 3 | checkin's credential authenticates against that host | same | pg code `28P01`/`28000` |
| 4 | Database named by `SHOPIFY_READ_DB` exists (name not typo'd, bootstrap created it) | same | pg code `3D000` |
| 5 | `sync_run` table exists (s-read migrated the mirror) | same | pg code `42P01` |
| 6 | checkin's DML role is a member of the mirror's NOLOGIN SELECT grant-holder (infra#136 bootstrap step) | same | pg code `42501` |
| 7 | s-read has actually run ≥1 sync (rows exist) | GET 200 `run: null` → line hidden — **identical to link 1's symptom** | `sync_run` count = 0 |
| 8 | Timestamps read sanely (UTC casts; #1042) | line renders but freshness is nonsense ("just now" for old runs) | negative computed age |
| 9 | Trigger side: `S_READ_TRIGGER_FUNCTION` set, IAM `lambda:InvokeFunction` granted, function exists | POST 503 or red "Failed to start" toast | env presence / AWS error class |

Links 2–6 are one opaque 500; links 1 and 7 render identically. That is the whole
problem — "it's not doing its job and I can't tell why" is the expected experience.

configHealth cannot fix this: it is presence-only **by design** — it runs on every
nav-badge poll, and anything that touches the mirror wakes the scale-to-zero Aurora
cluster. Deep probes must be on-demand.

## Design

One new endpoint that walks the chain and reports the **first broken link with its
specific cause**, plus one button that runs it. Nothing scheduled, nothing
persisted, nothing added to s-read.

### `GET /api/finance-ops/s-read/diagnose`

- Same `withAuth` gate as the sync route: `['isSysadmin', 'isBoardMember']`,
  session-only.
- On-demand only — a human clicked a button. Never polled, never cron'd
  (Aurora scale-to-zero; every probe is a paid wake-up).
- Returns an ordered list of step results:

```ts
type DiagStep = {
  id: string;          // stable slug, see below
  ok: boolean | null;  // null = skipped (an earlier step already failed)
  detail: string;      // human sentence; NEVER a secret, NEVER a connection string
  code?: string;       // pg SQLSTATE or AWS error name, when there is one
};
```

### Steps (server-side)

**`env`** — pure inspection, no I/O. Reports which resolution path won
(`SHOPIFY_READ_DATABASE_URL` override vs `DATABASE_URL`+`SHOPIFY_READ_DB`
derivation vs nothing), and the derived **database name and host only** (no
credentials, no full URL). Fails when `shopifyReadDatabaseUrl()` is null, naming
which input is missing.

**`mirror-read`** — links 2–7 are deliberately **one probe**, not six:
`SELECT count(*)::int AS runs FROM sync_run` through the existing
`shopifyRead/client` pool (reuse `getPool`; do not build a second pool — the
scale-to-zero comment in client.ts is load-bearing). One round trip either
succeeds or fails with a pg error whose `code` discriminates every layer:

| outcome | verdict emitted |
|---|---|
| `ENOTFOUND`/`ECONNREFUSED`/`ETIMEDOUT` | "Can't reach the mirror host — network/security-group/cluster-paused problem, not a grant problem." |
| `28P01`/`28000` | "Host reached, but checkin's credential was rejected." |
| `3D000` | "Connected, but database `<name>` doesn't exist — check `SHOPIFY_READ_DB` spelling / bootstrap created the DB." |
| `42P01` | "Database exists, but `sync_run` is missing — s-read has never migrated this mirror." |
| `42501` | "Table exists, but SELECT is denied — the DML role isn't a member of the NOLOGIN grant-holder yet (infra#136 bootstrap step)." |
| success, `runs = 0` | "Mirror readable but s-read has never completed a run — trigger a sync or check s-read's own logs." |
| success, `runs > 0` | ok, with the count |

**`latest-run`** — only when `mirror-read` succeeded with rows: the verbatim
latest `sync_run` (status, kind, startedAt, finishedAt, error, counts) via the
existing `latestSyncRun()`. This puts s-read's own `error` column — which today
nobody ever sees — in front of the operator.

**`clock`** — computed age of the latest run; flags `ok: false` when the age is
negative ("mirror timestamps are ahead of this server — timezone handling
regression, see #1042") and reports `process.env.TZ ?? '(unset)'`.

**`trigger-env`** — is `S_READ_TRIGGER_FUNCTION` set (report the function name —
it's a resource name, not a secret).

**`trigger-invoke`** — Lambda invoke with `InvocationType: "DryRun"`: validates
IAM permission *and* function existence **without running a sync**. Classifies
`AccessDeniedException` (IAM grant missing) vs `ResourceNotFoundException`
(function name wrong/env mismatch) vs success.

Steps after a failed prerequisite return `ok: null, detail: "skipped"` — the
report reads as "first broken link", not six cascading reds.

### Surfacing

1. **System-status health page** (`/system-status/health`): a "Shopify mirror
   (s-read)" card next to `ConfigHealthBox`, one "Run diagnostics" button →
   renders the step list, green/red per row, `detail` verbatim. No auto-run on
   page load (wake-up cost).
2. **Payments page**: the red "status can't be read" notification (#1045) gains
   one trailing sentence: "Run diagnostics on the System Status page to see
   why." No new UI on the payments page itself.
3. **Server log** already carries the underlying error
   (`"Failed to read the s-read sync status:"` in the sync route) — unchanged;
   the endpoint just makes the same information reachable without log access.

### Security notes

- The endpoint is inspection-only except `trigger-invoke`'s DryRun, which
  executes nothing.
- Never emit a connection string, password, or full URL. Host + database name
  only, and only to the board/sysadmin gate that already sees configHealth.
- pg error **codes** are safe to return; pg error **messages** can embed host
  detail — return our own sentences keyed on the code, log the raw error
  server-side.
- IAM: DryRun uses the same `lambda:InvokeFunction` grant the POST already has —
  no new permissions.

### Tests

- Route test at the client-module boundary (same pattern as the existing sync
  route tests): script each pg error code and assert the emitted step
  verdicts — this pins the code→sentence table above.
- One page test: button click → scripted diagnose response → rows render.
  (`mockFetchJson` can't do non-200s/method splits — use a local fetch mock,
  same as `payments/__tests__/page.test.tsx` does since #1045.)
- The negative-age clock case, with a future `startedAt` fixture — the one
  class tsc and mocks were blind to in #1041.

### Deliberately out of scope

- **No scheduled/continuous monitoring.** Every probe wakes Aurora; the daily sync
  cadence exists *because* of that cost (infra#129). Diagnostics are a human-clicked tool.
- **No result persistence / history.** Run it, read it, fix the link, run again.
- **No s-read-side changes.** `sync_run` (with `status`, `error`, `counts`) *is*
  s-read's telemetry; the gap was only that checkin never displayed it.
- **No new pool, no new Prisma client** — reuse `shopifyRead/client`.
- **No widening of configHealth** — it stays presence-only and cheap; the deep
  probe is a separate, on-demand thing. The configHealth mirror row's `detail`
  can mention the diagnostics page, nothing more.

## Runbook — diagnosing TODAY, before this is built

The most likely current state (per #1041's own warning: the feature is **inert
until infra's companion PR is applied and the bootstrap task has run**):

1. **Check the server log** for `Failed to read the s-read sync status:` — the
   attached error's `code` field maps directly to the table above. This is the
   single fastest discriminator and it already exists.
2. **No such log line and no status line?** Then the GET is 503ing (link 1) or
   returning `run: null` (link 7). Check the env for `SHOPIFY_READ_DB`; if set,
   the mirror is readable but empty — check s-read's own logs / trigger a sync.
3. **Grant check from psql** (as checkin's role):
   `SELECT count(*) FROM sync_run;` against the `shopify_read_<env>` DB —
   `42501` = bootstrap grant not applied (infra#136), `42P01` = mirror never
   migrated, `3D000` = wrong DB name.
4. **Trigger side**: red "Failed to start the Shopify sync" toast + server log
   `Failed to trigger s-read sync:` → IAM or function-name problem;
   `AccessDeniedException` vs `ResourceNotFoundException` in the logged error.

---

## Addendum: the match audit (data-level layer)

The diagnose endpoint proves the PLUMBING works; it says nothing about whether the
DATA reconciles. The match audit is that second layer: a bidirectional
Shopify ↔ activation completeness report.

**What's already merged vs what this doc's audit adds:** the mirror columns
(#1048: line variant ids + order discount codes), the plumbing diagnostics
(#1049), and the reconciler's own variant-item gate (#1074 — membership recovery
now checks the order carries a membership variant instead of amount-gating, with
a discount-aware gross fallback for pre-backfill rows, which killed the
couponed-order `AMOUNT_MISMATCH` false positive). The match audit below is the
remaining piece: the reconciler recovers and flags what it can ATTRIBUTE; nothing
merged yet reports completeness across everything.

**Scope rule (product decision):** "should reconcile" is decided by **variant id** —
BoardSettings holds the membership variants (`orgMembershipVariantId`,
`shopifyNormalVariantId`, `shopifyVolunteerVariantId`, plus the dev-mock variant
when the Shopify mock is active — the same set the reconciler's #1074 gate
builds), Program rows hold the program variants (`shopifyVariantId` + the legacy
org/non-org pair). An order with none of those variants on any line (donation,
t-shirt) is out of scope by design and never reported.

**Prerequisite:** the mirror previously carried no variant identity
(`shop_order_line` had sku/title only). s-read now mirrors
`variant_gid`/`variant_legacy_id` (migration `0000000000007_order_variant_and_discount_codes`, which also mirrors order-level `discount_codes`);
rows synced before that are null until a **backfill** run repopulates them — the
persisted bulk JSONL predates the query change, so `reingestBulkExports` cannot fill
these. The audit reports this state explicitly (`variantCoverage`) instead of
producing a falsely clean report.

**Endpoint:** `GET /api/finance-ops/s-read/match-audit` (board/sysadmin, on-demand
only, read-only — raises no PaymentExceptions). Surfaced as a panel on the payments
page. Buckets:

- *Shopify → activation*, every variant-matched order: `MATCHED` (claimed by a
  membership process or enrollment) / `TRACKED_EXCEPTION` (an unresolved
  PaymentException already covers it) / `UNCLAIMED_PAID` (**the gap**: money in,
  no access) / `UNCLAIMED_UNPAID` (informational).
- *Activation → Shopify*, every ACTIVE (or paid-pending-BG) INITIAL/RENEWAL process:
  `ORDER_MATCHED` / `MANUAL_CERTIFIED` (board certify-payment override, listed with
  who certified — the "what is manual" audit view) / `ORDER_NOT_IN_MIRROR` /
  `NO_PAYMENT_BASIS` (**the gap** — finally computes the `ACTIVE_WITHOUT_PAYMENT`
  case that had an enum value and alert copy but no producer). PERSON_BG processes
  are excluded: they carry no payment by design.
- *Enrollments*: same, with `SCHOLARSHIP_APPROVED` (`wasOrgMemberAtApproval`
  stamped) as the legitimate manual class.

**Reconciler fix that fell out of the audit design:** `runReconcile` advanced its
cursor past an order whose forward pass THREW, skipping it forever; the cursor now
freezes at the first failure (later orders still process — idempotent — and get
re-scanned next run).

**Still deliberately not covered:** raising PaymentExceptions from audit findings
(read-only first; promote to exceptions once the board has seen real output), Fee /
FeePayment program-fee reconciliation, and any per-line amount validation.

**Open follow-up — coupon entitlement:** #1074 solved the coupon *false positive*
(amount no longer gates variant-backed orders), but nothing yet rules on WHO may
use a code: a non-volunteer family redeeming the volunteer-rate coupon now
activates cleanly with no flag, since the variant check passes and the amount
check no longer applies. The mirrored `discount_codes` column exists precisely
for this; the sketched fix is a tiny board-owned registry —
`DiscountCodeRule { code, volunteerOnly, validUntil }` — validated by the
reconciler (unregistered/expired code or volunteer code on a non-volunteer
family → exception naming the code). Not built; build when the board wants the
entitlement enforced rather than eyeballed.
