# Membership Lapse / Revocation → Program-Enrollment Cascade

**Status:** built on `feat/membership-lapse-cascade` (post-first-release).
**Interview decision:** "grace then auto-withdraw" (2026-07-07).
**Supersedes the manual board job** on the household detail page (#915) for the
detection/flag/block/withdraw arc; the manual revoke button (household ops POST)
stays as the human trigger for a revocation.

## 1. Problem

When a household's org membership lapses (the membership year boundary passes
without a completed renewal) or is revoked by the board, nothing today cascades
to that household's program enrollments. Members keep checking in, keep enrolling
in new programs, and keep held/pending program seats they're no longer entitled
to. Today the only lever is a board member manually revoking on the household
detail page (#915) — and even that doesn't touch program enrollments.

## 2. Decision (from the product interview)

1. **On lapse or revocation** a household's program enrollments are **flagged**
   (visible on the ops surface), its members are **blocked** from check-in and
   from **new** enrollment, and **both the household and the board are notified**
   (once — not re-emailed daily).
2. **After a configurable grace window** (`BoardSettings.membershipLapseGraceDays`,
   `Int?`) the household's **pending** enrollments are **auto-withdrawn**.
   `NULL = auto-withdraw OFF` — flag/block/notify stay on, enrollments are only
   ever withdrawn manually. This mirrors `scholarshipDenialGraceDays`' NULL-is-off
   semantics exactly (never guess a default).
3. **Withdrawal routes through the shared `withdrawAndReleaseHold`**
   (`lib/program/capacity.ts`) so every scholarship inventory hold is released
   `+1` exactly once and Shopify seat accounting stays correct
   (see `docs/PROGRAM_CAPACITY_AND_SCHOLARSHIPS.md`). History/audit is preserved;
   **renewal before the deadline clears the flag** and blocks nothing further.

## 3. What counts as "lapsed" — a derivation, not a status

`OrgMembershipStatus` has no `LAPSED` value, and the renewal flow deliberately
does **not** auto-revoke (`lib/membership/renewal.ts`: "No auto-revoke — manual
admin action"). So lapsed-ness is **derived live** from `OrgMembership`
(`isMembershipLapsed`, `lib/membership/lapse.ts`):

> A household is **lapsed** when its membership status is **REVOKED** or
> **DENIED**, **or** its status is **ACTIVE** but it has an **incomplete RENEWAL
> process past the membership-year boundary** (the "year boundary passed without
> renewal" case).

- **REVOKED / DENIED** — a board act; `isActiveOrgMember` is already false. DENIED
  additionally blocks login (so the check-in block is moot for them), but their
  enrollments still cascade — losing membership is losing membership.
- **ACTIVE + overdue renewal** — a renewal opens `RENEWAL_LEAD_MONTHS` before the
  boundary `B`, so `nextBoundary(boundary, process.createdAt) === B`; once
  `now > B` and the renewal is still in an incomplete status
  (`PENDING_RENEWAL` / `RENEWAL_PENDING_BG` / `PENDING_PAYMENT`) the household has
  lapsed. Completing the renewal moves the process out of those statuses, so the
  derivation flips false the instant they renew.
- **NONE / no membership** is **never** lapsed — those are legitimate non-members
  whose (non-member-priced) program enrollments must not be swept.

### Why derive, and stamp only for grace/dedup

Every place that *gates behavior* — the check-in guard, the new-enrollment guard,
and the cron — calls the same live predicate, so a renewal or reactivation lifts
the block **immediately**, with no denormalized flag to keep in sync. We stamp
exactly one field, and only for the two things a derivation can't do by itself:

- **`OrgMembership.lapseFlaggedAt DateTime?`** (household-level, via the 1:1
  membership). Chosen over a per-`ProgramParticipant.membershipLapsedAt` stamp
  because lapsed-ness is a **household** property, not a per-enrollment one: one
  stamp drives the **grace clock** (one deadline for the whole household) and the
  **notification dedup** (one household + board notice), with zero per-row
  denormalization to write or reconcile. It is **never** read to decide "is this
  household blocked right now?" — that stays derived — so a stale stamp can never
  block a renewed member. `@sensitivity:public`, matching the rest of
  `OrgMembership`; it never enters a member-facing response.

## 4. Data model

| Field | Type | Meaning |
|---|---|---|
| `OrgMembership.lapseFlaggedAt` | `DateTime?` | When the cron first flagged this membership as lapsed. Grace-clock + dedup only. `NULL` = not currently flagged. |
| `BoardSettings.membershipLapseGraceDays` | `Int?` | Grace days before pending enrollments auto-withdraw. `NULL` = auto-withdraw OFF. |

Migration `20260709010000_membership_lapse_cascade`: two additive nullable
columns (expand step; safe on populated tables — no backfill, no default).

## 5. Flows

### Detection cron — `GET /api/cron/membership-lapse-cascade` (daily)

`withCron` + `CRON_SECRET`, mirroring the other crons. Thin route → delegates to
`runLapseCascadeSweep(now)` (`lib/membership/lapse.ts`) so the sweep is unit- and
integration-testable directly (the trusted-adult-expiry pattern). The route file
touches no `prisma` and reads no edge model, so it needs no `EDGE_INCLUDE_ALLOWLIST`
entry. Scheduling is an **infra follow-up** (add alongside the existing cron
schedules).

Each run:

1. **Find lapsed** memberships (candidates = REVOKED/DENIED, or ACTIVE with an
   incomplete renewal; then filtered by the live predicate).
2. **Flag + notify the newly-lapsed** (those with `lapseFlaggedAt == null`): stamp
   `lapseFlaggedAt = now`, audit (`reason: "membership_lapsed"`), email the
   household's leads once, and collect them for **one** board digest email. An
   already-flagged household is skipped → **no daily re-email**.
3. **Auto-withdraw** (only if `membershipLapseGraceDays` is set): for every lapsed
   household flagged longer ago than the grace window, withdraw its **PENDING**
   enrollments **one row at a time** through `withdrawAndReleaseHold`, each with a
   `reason: "membership_lapse_withdrawn"` audit row.
4. **Clear stale flags**: any membership with `lapseFlaggedAt` set that is no
   longer lapsed (renewed / reactivated) has the stamp cleared
   (`reason: "membership_lapse_cleared"`), so a future re-lapse notifies again.

### Why PENDING-only auto-withdraw

`withdrawAndReleaseHold` deletes the row and fires the compensating `+1` **only if
`inventoryHeldAt` was set**. That's correct for **PENDING** rows (awaiting payment
or holding a scholarship seat) — reclaiming a not-yet-paid seat on lapse is right,
and the hold ledger stays balanced. An **ACTIVE** row is a paid/comped completed
transaction: deleting it restores **no** seat (the sale already decremented
Shopify and there's no outstanding hold to release), so auto-withdrawing it would
destroy paid value and drift capacity. So the sweep touches PENDING only; a member
who **pays** a pending enrollment during grace **rescues** it (it becomes ACTIVE
and is no longer swept). The board can still manually remove an ACTIVE enrollment
if policy requires. The all-enrollment *flag/block* is broader than the
PENDING-only *withdraw* — deliberately.

### Blocking guards (live predicate, `householdMembershipLapsed`)

- **Check-in** (`POST /api/scan`): a lapsed household's member gets a `403`
  ("membership has lapsed … renew to check in"). **No override** — check-in is a
  facility-access decision, and DENIED already can't log in.
- **New enrollment** (`POST /api/programs/[id]/participants`): a lapsed household's
  member gets a `403` inside the `enforceLimits` block. A **board/sysadmin
  force-enroll from outside the household still works** — that path sets `override`
  and skips `enforceLimits` entirely (`isExternalAdmin`), so it never reaches the
  guard. A household enrolling *itself* has no self-override — it must renew.

Both guards derive live, so a renewal/reactivation lifts the block instantly,
regardless of when the cron next runs.

### Ops visibility

The board household-detail page (`/membership-ops/households/[id]`, the #915
surface) shows a **"Membership lapsed — enrollments flagged"** badge when
`orgMembership.lapseFlaggedAt` is set (the field flows through the existing
admin-only, hand-shaped `orgMembership: true` include — public tier, no registry
change). Broader per-roster badges on the program-ops rosters are deferred (§8);
the `householdMembershipLapsed` / `isMembershipLapsed` helpers are the reusable
derivation for them.

## 6. Notifications & dedup — and reconciliation with PR #958

Per the standalone-on-main decision, this PR ships its **own minimal** dedup
plumbing rather than depending on the open **PR #958 (staleness framework /
`NotificationLedger`)**. The dedup key here is simply **`lapseFlaggedAt` being
null vs. set**: notify on the `null → set` transition, never again while set,
reset on clear. Emails go through `lib/emailRecipients` (`emailHouseholdLeads`,
`emailBoardMembers`) → `lib/email.ts` `sendEmail` only.

**When #958 merges**, the reconciliation is: replace the `lapseFlaggedAt`-as-dedup
role with a `NotificationLedger` entry keyed by `(household, "membership_lapsed",
cycle)`, and keep `lapseFlaggedAt` for its **other** job — the grace clock — since
the ledger dedups *notifications*, not the *auto-withdraw deadline*. The board
digest becomes one ledger-backed batch. No schema conflict is expected: `#958`
adds its own ledger table; this PR only adds `lapseFlaggedAt` + the grace knob.
If #958 lands first, this feature's notify calls should be ported to the ledger in
the merge; if this lands first, #958 subsumes the ad-hoc dedup. Either order is a
localized change in `lib/membership/lapse.ts`.

## 7. Prod safety

- **Migration** is additive + nullable (expand); no backfill, safe on the
  populated prod tables (per `docs/DEPLOY_MIGRATION_ORDER_OF_OPERATIONS.md`).
- **`membershipLapseGraceDays` defaults to NULL** on the singleton, so **shipping
  this changes no behavior until the board configures a grace period** — until
  then the cascade flags/blocks/notifies but never auto-withdraws.
- **Best-effort external calls**: `withdrawAndReleaseHold`'s Shopify `+1` already
  logs + emails on failure and never throws; each withdraw and each notify is
  isolated per row/household so one failure doesn't abort the sweep. Emails never
  fail the sweep.
- **Idempotent**: re-running the cron re-flags nobody (dedup), re-withdraws
  nothing already gone (a re-deleted row hits Prisma P2025, caught per row), and
  re-clears nothing.

## 8. Deliberately deferred

- **Cron schedule wiring** — infra follow-up (this PR ships the route + auth
  gate; the schedule entry lands with the other cron schedules).
- **Per-roster lapse badges** on the program-ops surfaces — the derivation helper
  is shipped; wiring badges into every roster is display-only follow-up.
- **Auto-withdrawing ACTIVE (paid) enrollments** — intentionally out of scope
  (would destroy paid value / drift Shopify; see §5). Manual board removal covers
  the rare case.
- **`NotificationLedger` integration** — pending PR #958 (§6).
