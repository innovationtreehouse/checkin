# s-read sync diagnostics

**Status: SHIPPED.** Verified in tree: the plumbing probe
`api/finance-ops/s-read/diagnose` + its System Status card (`SystemHealthPanels.tsx`
fetches it), and the data-level layer `api/finance-ops/s-read/match-audit` +
`MatchAuditPanel`. The step list, pg-error→sentence table, and probe mechanics are
ground truth in the route; this doc keeps only the decisions and constraints.

**Motivating pain:** the sync-status feature (#1041/#1045) sits at the end of an
eight-link chain (env → network → auth → DB exists → table exists → grant → rows
exist → sane clock, plus the Lambda trigger side), and every broken link collapses
into one of two indistinguishable symptoms — the status line silently doesn't
render, or "sync started but its status can't be read." The diagnose endpoint
walks the chain and reports the **first broken link with its specific cause** (pg
SQLSTATE / AWS error class), turning "it's not working and I can't tell why" into
a named link.

## Load-bearing decisions & constraints

- **On-demand only — never polled, never cron'd.** Every probe wakes the
  scale-to-zero Aurora cluster; the daily s-read cadence exists *because* of that
  cost (infra#129). This is why `configHealth` stays **presence-only by design**
  (it runs on every nav-badge poll) and the deep probe is a separate human-clicked
  tool. Do not add scheduled/continuous monitoring, and do not widen configHealth.
- **Reuse the existing `shopifyRead/client` pool** (`getPool`) — do **not** build
  a second pool; the scale-to-zero comment in `client.ts` is load-bearing. Links
  2–7 are deliberately **one probe** (`SELECT count(*) FROM sync_run`), not six —
  a single round trip whose pg `code` discriminates every layer
  (`ENOTFOUND`/`ECONNREFUSED` = host; `28P01` = credential; `3D000` = wrong DB;
  `42P01` = never migrated; `42501` = NOLOGIN grant not applied per infra#136;
  `runs=0` = mirror readable but s-read never ran).
- **Security:** never emit a connection string, password, or full URL — host +
  database name only, to the same board/sysadmin gate configHealth already uses.
  pg **codes** are safe to return; pg **messages** can embed host detail, so
  return our own sentences keyed on the code and log the raw error server-side.
  `trigger-invoke` uses Lambda `DryRun` — validates IAM + function existence
  without running a sync, on the grant the POST already holds (no new permissions).
- **No s-read-side changes, no persistence.** `sync_run` (`status`/`error`/`counts`)
  *is* s-read's telemetry; the only gap was that checkin never displayed it.
  Run it, read it, fix the link, run again.

## Addendum: the match audit (data-level layer)

The diagnose endpoint proves the PLUMBING works; the match audit
(`api/finance-ops/s-read/match-audit`, board/sysadmin, on-demand, read-only) is a
bidirectional Shopify ↔ activation completeness report. Already merged around it:
the mirror variant/discount columns (#1048), the plumbing diagnostics (#1049), and
the reconciler's variant-item gate (#1074 — recovery checks for a membership
variant instead of amount-gating, killing the couponed-order `AMOUNT_MISMATCH`
false positive). The audit is the remaining piece: nothing merged yet reports
*completeness* across everything.

- **Scope rule (product decision): "should reconcile" is decided by variant id.**
  BoardSettings holds the membership variants (+ the dev-mock variant when the
  Shopify mock is active — the same set #1074's gate builds); Program rows hold
  the program variants. An order with none of those on any line (donation,
  t-shirt) is out of scope by design and never reported.
- **The two gap classes it finally computes:** `UNCLAIMED_PAID` (money in, no
  access) on the Shopify→activation side, and `NO_PAYMENT_BASIS` (the
  `ACTIVE_WITHOUT_PAYMENT` case that had an enum value + alert copy but no
  producer) on the activation→Shopify side. Manual classes (`MANUAL_CERTIFIED`
  board override, `SCHOLARSHIP_APPROVED`) are listed with who certified — the
  "what is manual" audit view. PERSON_BG processes are excluded (no payment by
  design).
- **Variant-coverage caveat.** The mirror only recently gained variant identity
  (`variant_gid`/`variant_legacy_id`) + order `discount_codes`; rows synced before
  that are null until a **backfill** repopulates them (the persisted bulk JSONL
  predates the query change, so `reingestBulkExports` can't fill these). The audit
  reports this state explicitly (`variantCoverage`) instead of a falsely clean
  report.
- **Cursor-once fix (design invariant):** `runReconcile` freezes its cursor at the
  first order whose forward pass throws — advancing past it would skip that order
  forever; later orders still process (idempotent) and it re-scans next run.

**Deliberately not covered:** raising PaymentExceptions from audit findings
(read-only first; promote once the board has seen real output), Fee/FeePayment
reconciliation, and per-line amount validation.

**Open follow-up — coupon entitlement.** #1074 solved the coupon *false positive*
(amount no longer gates variant-backed orders), but nothing yet rules on **who**
may use a code: a non-volunteer family redeeming the volunteer coupon now
activates cleanly with no flag. The mirrored `discount_codes` column exists
precisely for this; the sketched fix is a tiny board-owned registry
(`DiscountCodeRule { code, volunteerOnly, validUntil }`) validated by the
reconciler. **Not built — build when the board wants entitlement enforced rather
than eyeballed.**
