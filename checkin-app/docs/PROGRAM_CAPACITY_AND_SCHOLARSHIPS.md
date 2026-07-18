# Program Capacity & Scholarships

**Status:** Merged — PR #930 (`4cb5d1d2`), with #926 (`a86f3727`, request guarded to
PENDING) and #931 (`34a92fb7`, org-member snapshot at approval) on top.
**Product decisions:** 2026-07-06 (single-pool capacity, hold-ledger scholarship lifecycle).
**Statechart:** the enrollment trunk + scholarship parallel region are formalized as one
declarative machine — see `designs/LIFECYCLE.md`. This doc (§1–4) is the Shopify/capacity
mechanics it builds on.

## 1. Shopify is the source of truth for program capacity

A program's enrollment capacity is not tracked as a separate counter in the app — it lives
in Shopify's own inventory for the program's variant. `Program.maxParticipants` sets the
*initial* Shopify inventory at creation time and drives `PATCH /api/programs/[id]`'s
relative delta propagation (`adjustProgramInventory`, `lib/shopify.ts`), but from then on
Shopify's `available` count for the variant is what's authoritative — every seat-consuming
or seat-returning event in the app fires a corresponding relative adjustment
(`inventory_levels/adjust`, `available_adjustment: delta`) rather than an absolute set,
because Shopify decrements `available` itself as seats sell and the app doesn't need to
know that running total to stay in sync.

## 2. Single pool, single variant

Each program has **one** Shopify variant, priced at the base (non-member) rate
(`Program.shopifyVariantId`). Inventory on that one variant IS the program's whole
capacity — there is no second, member-priced pool to keep numerically consistent.

Members pay less at the same variant via a **server-minted, single-use discount code**
(`mintMemberDiscountCode`, `lib/shopify.ts`): a Shopify Price Rule + Discount Code, fixed
amount off, usage limit 1, ~48h expiry, minted per checkout by
`POST /api/programs/[id]/discount-code` after recomputing the caller's membership status
server-side (never trusting a client flag). A failed mint degrades to an undiscounted link
— checkout is never blocked.

This is an interim mechanism. `docs/designs/SHOPIFY_MEMBER_SEGMENT_PRICING.md` is the
planned upgrade — segment-gated automatic discounts, once checkout identity (that doc's
§5) is solved — at which point per-checkout discount codes go away entirely.

### Legacy two-variant transition

Programs created before this design still carry two variants
(`shopifyOrgMemberVariantId` / `shopifyNonOrgMemberVariantId`), each with its own
inventory pool mirrored via a sibling-adjustment on every seat-consuming event (the
webhook's `orders/paid` handler mirrors the purchased tier's decrement onto the other
pool). `adjustProgramInventory` prefers `shopifyVariantId` when set and falls back to the
legacy pair otherwise — this is additive, not a widening of what any one program accepts;
a given program only ever populates one shape or the other.

This is an **expand** step. Dropping the legacy pair (**contract**) is a later release,
once every program has migrated onto the single-pool model — per the repo's
migration-safety convention of expand/contract as separate steps.

## 3. Scholarship lifecycle — the hold ledger

A scholarship / payment-plan request takes a seat out of Shopify's pool the moment it's
requested, not when it's approved. The invariant: **every application-time `-1` is
returned `+1` exactly once**, by whichever of three release paths fires first, or is
**consumed permanently** by approval. `ProgramParticipant.inventoryHeldAt` is the ledger's
state: non-null means a hold is outstanding.

```
                          ┌──────────────┐
                 apply    │              │  approve
        PENDING ───────►  │  HELD        │ ───────────►  ACTIVE (comped)
     (no hold)   -1       │ (inventoryHeldAt set)        inventoryHeldAt -> null
                          │              │               (hold CONSUMED, no +1 ever)
                          └──────┬───────┘
                                 │ deny (no Shopify op)
                                 ▼
                          ┌──────────────┐
                          │  HELD +      │  re-apply (same seat, no 2nd -1)
                          │  DENIED      │ ─────────────────────────────► back to HELD
                          │ (paymentPlanDeniedAt set)   (deniedAt cleared)
                          └──────┬───────┘
                                 │
              ┌──────────────────┼───────────────────────┐
              │ (a) withdraw     │ (b) pay anyway         │ (c) grace expires
              ▼                 ▼                        ▼
     +1, row removed     +1 (compensates the       +1, auto-withdrawn
                          webhook's real sale),     (reuses path (a))
                          row -> ACTIVE
```

### Application (`POST /api/programs/[id]/request-payment-plan`)

Stamps `inventoryHeldAt = now()` and clears `paymentPlanDeniedAt`, guarded so the `-1`
only fires the moment `inventoryHeldAt` transitions **null → set**. A denied re-applicant
already has `inventoryHeldAt` set (denial never clears it — see below), so re-applying
just flips `isPaymentPlanRequested` back to `true` and clears the denial stamp — it does
**not** decrement a second time for a seat it's already holding. On a genuine transition
(fresh hold or re-request after denial) this now emails the Scholarship Review Team and
sends the applicant household an acknowledgement — see §5.

### Denial (`POST /api/finance-ops/payment-plans/refuse`)

Performs **no Shopify operation**. The seat stays held exactly as the application left it
— `isPaymentPlanRequested` clears and `paymentPlanDeniedAt` stamps, but `inventoryHeldAt`
is untouched. The applicant may still pay normally; a board member did not "give away"
their held seat by saying no to a payment plan. (This supersedes an earlier design where
denial fired a `+1` — that let the seat resell out from under a denied-but-not-withdrawn
applicant, silently drifting DB capacity and Shopify's count apart.) Sends no automatic
email — see §5.

### Approval (`POST /api/finance-ops/payment-plans`)

No Shopify operation either (the seat was already taken out of the pool at application
time) — approval only stops billing the applicant. It additionally clears
`inventoryHeldAt` to `null` **without** a `+1`: the hold is **consumed**, not released. An
approved participant is a permanent comped enrollment; if they're later removed from the
program, that removal must not credit a seat back that was never returned to Shopify. Sends
no automatic email — see §5.

### Release, exactly once — three paths

All three share one implementation, `withdrawAndReleaseHold`
(`lib/program/capacity.ts`): delete the `PENDING` row, and if the deleted row's
`inventoryHeldAt` was set, fire the compensating `+1`. `delete()` is the atomicity
boundary — a given row can be deleted at most once, so double-release across concurrent
callers isn't possible; a second delete attempt hits Prisma P2025 and is treated as an
idempotent no-op by every caller.

**Failure semantics (best-effort, not transactional).** The DB write and the Shopify
call cannot share a transaction, so "every −1 comes back +1 exactly once" is guaranteed
against *failed calls* but not against *crashes between the two steps*:

- **Failed `-1` at application time**: the hold stamp is rolled back
  (`request-payment-plan` clears `inventoryHeldAt` again), so no phantom hold is
  recorded; re-submitting retries the decrement. Every failure also emails
  sysadmins/board via `reportShopifyFailure`.
- **Failed `+1` at release time**: the row is already deleted; the caller gets a
  `warning` and the same failure email goes out. Reconciliation is manual (**Sync to
  Shopify** / System Status → Link Status).
- **Crash windows** (process dies between the DB commit and the Shopify call): a
  stranded hold or a missed release can survive. These are visible in the DB
  (`inventoryHeldAt` vs. Shopify's count) and are fixed by the same manual sync; a
  periodic reconcile job is deliberately deferred until the drift is observed in
  practice.

- **(a) Withdrawal** — `DELETE /api/programs/[id]/participants` (self, admin, or
  board removal; the same route handles all three) funnels through this. This is
  also now the *only* path a non-payment kick takes: `cron/pending-participants`
  no longer removes anyone itself (reviewer decision — removal is a human,
  board-driven action, not something a cron does unattended). The cron warns the
  household at day 1/3/6 and, from day 3 on, digests the board so a person
  decides whether to remove the enrollment via this same admin route.
- **(b) Normal payment** — the `orders/paid` webhook's activation path. A denied
  applicant who pays anyway makes Shopify auto-decrement a *second* unit for the same
  seat (the application's hold already took one out); the webhook releases the hold
  (+1) to compensate, guarded transactionally (`inventoryHeldAt` not-null → null) so a
  webhook retry can't release twice. Never allowed to fail the webhook's 200 — Shopify
  retries the whole order on a non-2xx.
- **(c) Grace-period expiry** — `cron/scholarship-grace-expiry`. See below.

## 4. Grace-period expiry

`BoardSettings.scholarshipDenialGraceDays` (nullable int; **NULL = the feature is off**,
never a guessed default) sets how many days a denied applicant keeps their held seat
before being auto-withdrawn. The cron sweep (`GET /api/cron/scholarship-grace-expiry`,
`Authorization: Bearer $CRON_SECRET`, same auth guard as every other cron route) finds
`PENDING` rows with `isPaymentPlanRequested: false`, `inventoryHeldAt` set,
`paymentPlanDeniedAt` set, and `paymentPlanDeniedAt + scholarshipDenialGraceDays days` in
the past, then auto-withdraws each one (reusing release path (a) — semantically, expiry
*is* auto-withdrawal + seat restore) and audit-logs with a distinct
`reason: "scholarship_grace_expired"` context so it reads differently from a manual
withdrawal in the audit trail. Each row is processed independently (a per-row failure
doesn't block the rest of the sweep), and the sweep never touches non-`PENDING` rows —
an approved (`ACTIVE`) participant's hold was already consumed, not left outstanding, so
it can never match this query regardless of how old `paymentPlanDeniedAt` is.

Configured on the membership settings surface (`/settings/membership` →
`PUT /api/settings/membership`), alongside the other board policy knobs
(`bgRecheckMonths`, dues) — board/sysadmin only, audit-logged, blank input clears it back
to `null`.

## 5. Notifications

**User decision: an applicant receives exactly one automatic email — the request
acknowledgement.** `src/lib/scholarshipEmails.ts` resolves recipients / fans out; callers
build their own subject/html and pass them in. Sends fire *after* the state transition
commits, fire-and-forget (a failed send never fails the request), and only when the
request actually transitioned (no duplicate mail on a no-op re-POST). Recipient
resolution itself lives in `src/lib/emailRecipients.ts` (`resolveHouseholdRecipients`) — a
household-generic helper, not scholarship-specific — with `scholarshipEmails.ts`
re-exporting it as `resolveScholarshipRecipients` for its existing call sites. The
pending-participants cron (rows below) calls `resolveHouseholdRecipients` directly.

**1. Who is emailed when:**

| Event | Route | Review Team | Household |
|---|---|---|---|
| Program request (fresh hold or re-request-after-denial) | `POST /api/programs/[id]/request-payment-plan` | ✅ `scholarshipNotifyEmail` → else all board | ✅ ack (leads ∪ participant), ungated |
| Membership request | `POST /api/membership/request-payment-plan` | ✅ | ✅ ack (leads only), ungated |
| Program approve | `POST /api/finance-ops/payment-plans` | — | **no automatic email** |
| Program deny | `POST /api/finance-ops/payment-plans/refuse` | — | **no automatic email** |
| Membership approve (certify) | `POST /api/finance-ops/membership-payment-plans` | — | **no automatic email** |
| Membership deny | `POST /api/finance-ops/membership-payment-plans/refuse` | — | **no automatic email** |
| Manual-hold | `…/payment-plans/manual-hold` | — | **no email** |
| Non-payment warning (day 1 / 3 / 6) | `GET /api/cron/pending-participants` | — | ✅ warning (non-payer household: leads ∪ participant), ungated |
| Leadership digest (board) | `GET /api/cron/pending-participants` | ✅ all board (`emailBoardMembers`) — one digest per run, day-3 + day-7+ tiers | — |

(The cron rows are not scholarship-applicant emails — the sweep excludes requested and
denied rows by design; they are ordinary non-payment notices and do not count against the
one-automatic-email rule.)

**2. Approve/deny are silent by design.** Board decisions — program approve, program deny,
membership approve — send **no** automatic applicant email; the Scholarship Review Team
communicates its decision **manually**. A consequence: a **denial** starts the
`scholarshipDenialGraceDays` clock (§4) with no automatic notice, so the board's manual
denial message should state the deadline itself; the grace-expiry auto-withdraw (§4) also
sends nothing when it fires — both silences are deliberate, not gaps.

**3. Fallback rule.** `BoardSettings.scholarshipNotifyEmail` unset (or unparseable) → email
**all board members** (the board *is* the review team until configured). Set on
**Settings → Email** (distinct from `scholarshipDenialGraceDays`, set on Settings → Membership).

**4. Membership deny — parity closed, still silent.** The membership side now has both approve and deny (`POST /api/finance-ops/membership-payment-plans/refuse`). Denial clears `isPaymentPlanRequested` back to `false`; the process stays `PENDING_PAYMENT` and the household returns to normal pay-to-activate (membership holds no seat and has no grace cron, so denial state is the cleared flag plus the audit row). Like every other board decision it sends **no automatic email** — the board communicates the denial manually.

**5. The pending-participants cron never removes anyone — reviewer decision (this is core
customer service and a computer isn't enough here).** Day-1/3/6 household warnings send to
leads ∪ participant, ungated, exactly as before (previously `[EMAIL DISPATCH]` log stubs
while the kick itself really fired — the warnings are real sends, see table above). Day-7+
rows are classified `overdue`, not deleted; removal is a manual board action via the
existing `DELETE /api/programs/[id]/participants` admin surface (§3(a)), which still routes
through `withdrawAndReleaseHold` for the hold-ledger release. Any communication that
accompanies a manual removal is manual too, the same way the board's manual
approve/deny/scholarship communications work (§5.2) — there is no automatic
"you've been removed" email. **In addition to the day-1/3/6 warnings, the cron sends one
leadership digest per run** (`emailBoardMembers`, subject `Non-payment digest: <a>
approaching deadline, <b> overdue`) whenever there's at least one day-3 ("approaching
deadline") or day-7+ ("overdue") row, listing each by person/program/day-count so the
board can decide whether to remove an enrollment or reach out to the household. Nothing
sends when both lists are empty.

## 6. Related

- `docs/designs/SHOPIFY_MEMBER_SEGMENT_PRICING.md` — the segment-gated pricing design
  that per-checkout discount codes stand in for until checkout identity is solved.
- `docs/DEPLOY_MIGRATION_ORDER_OF_OPERATIONS.md` — the expand/contract migration
  convention this design's legacy-variant transition follows.
