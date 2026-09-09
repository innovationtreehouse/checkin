# The membership year a settlement buys is stated, not inferred

## Problem

When a family pays for membership, the system has to know which membership year
the money bought — this year, or the coming one. It never records that answer.
It works it out afterwards from a timestamp: the moment the family's application
finished its last step. For a family renewing, that moment always lands in the
renewal window, so the guess is always right. For a family joining for the first
time, it can land anywhere, and the guess can be wrong.

The case that makes it wrong is ordinary. A family joins in late June or early
July to sign a child up for a summer program, pays that day, and their
background check clears a few days later — after the renewal window has opened.
The system reads the clearance date, sees it inside the window, and concludes the
family bought the *coming* year. It did not; it bought the year it joined in. The
consequence is that the renewal sweep never asks them to renew, and they receive
roughly thirteen months of coverage for one year's fee. An identical family whose
review happened to finish a few days earlier gets the correct horizon. Which year
a family's money bought is being decided by how fast a board reviewer worked.

The deeper fault is that a fact — *which year did this purchase cover* — is being
re-derived every time it is read, from a signal that was never meant to answer
it. There is no timestamp that answers it correctly in every case, because the
answer is not a matter of timing at all. It is a property of what was bought.

## Objective

Every membership settlement records the membership year it bought. Coverage
horizons, the renewal sweep, and program pricing read that recorded year instead
of inferring one from when a stage completed.

## Executive summary

**For a family**, the summer-join case stops leaking. A family that joins to buy
the current year is asked to renew for the coming year on the normal schedule,
and a family that genuinely buys the coming year is not. Nothing changes for a
renewal — a renewal has only ever bought the coming year, and it still does.

**For the board**, a membership can now be granted for a specific year, and the
grant records which. When the current date makes the year unambiguous the app
fills it in; only inside the renewal-window overlap, where both the current and
the coming year are plausible, is the board asked which year the grant is for.

**For operations**, the single evergreen Shopify membership variant becomes one
variant per membership year. Each year's variant is what tells a purchase which
year it bought. Rolling a new year is adding that year's variant to a mapping
before its renewal window opens — the same shape of task as setting up any
year's catalogue.

**The cost** is one nullable integer column on the settlement record, a
variant-to-year mapping replacing one variant id, a stamp on each settlement
path, a one-time backfill of live data, and the removal of the timestamp-based
inference the column replaces.

**Deliberately not in scope:** what the membership year *is* (1 September to 31
August, one boundary for the whole organisation — Policy, unchanged), what dues
cost, who counts as a member, and when a membership covers what. This design
changes only how the year a settlement bought is recorded and read.

## Rules this relies on and intends to change

Relied on, from `docs/rules/membership.md`, all Policy and unchanged:

- The membership year runs 1 September to 31 August, with one boundary for the
  whole organisation. The integer that names a year is defined against that
  boundary; the design does not touch the boundary itself.
- The fee is per family per membership year, and a payment may buy less than
  twelve months when a family joins partway through. The declared year is exactly
  the year that payment buys.

Changed, in `docs/rules/membership.md`, the Procedure (`[Decision]`) rule under
Renewal that today reads:

> Settling inside the renewal window buys the coming membership year — for a
> family joining (INITIAL) exactly as for one renewing. The derived valid-until,
> program-pricing coverage, and the renewal sweep's skip-test all read this one
> rule…

This design keeps the *intent* — a family that buys the coming year is covered
for it and not asked to renew it — but replaces the *mechanism*. "Settling inside
the renewal window" was a proxy for "bought the coming year" that holds for
renewals and fails for the summer INITIAL. The replacement is that the settlement
states its year outright. The rule's replacement text is in the migration file.

Relied on, from `docs/rules/principles.md`: *missing or ambiguous data resolves to
the more restrictive reading*. The inference this design removes resolves an
ambiguous case (pay pre-window, clear post-window) to the *more generous* reading
— thirteen months of coverage. Recording the year removes the ambiguity rather
than merely re-pointing it.

## Naming a membership year

A membership year spans two calendar years — with a 1 September boundary it runs
from 1 September of one year to 31 August of the next — so its **name is the
spanning form, `2026-27`**: the year the boundary opens in, and the year it
closes in. That is what a human sees anywhere a membership year is shown, and it
is unambiguous in a way a bare `2026` is not.

**Stored as a single integer — the opening-boundary year (`2026`).** The closing
half is always the opening half plus one, so storing both would be storing a
derivable fact twice; the `2026-27` label is *formatted* from the one integer by
a shared helper, not stored. The integer is not a stored date, for the same
reason program design gives: a stored date would be a second copy of the board's
boundary setting, wrong from the moment the setting moved and silently so. The
integer re-resolves against the current boundary every time it is read.

This is the identical storage scheme already chosen for programs in
`docs/in-design/PROGRAM_MEMBERSHIP_YEAR.md` — see
[Reconciliation with program fiscal year](#reconciliation-with-program-fiscal-year-1484).
The one addition here is a shared **display helper** that renders that integer as
the `2026-27` span, so a member reads the same label for a program's year and for
the year their own dues cover.

**Precisely which year "the coming year" is.** At any instant *now*, let
`nextBoundary` be the next occurrence (≥ *now*) of the configured boundary's
month and day — the existing `nextBoundary(boundary, now)` in
`checkin-app/src/lib/programYear.ts`. Then:

- The **current** membership year — the one the organisation is living in — has
  the integer key `nextBoundary.getUTCFullYear() - 1` (displayed `2025-26`).
- The **coming** membership year — the one a renewal or an in-window join buys —
  has the integer key `nextBoundary.getUTCFullYear()` (displayed `2026-27`).

At the boundary instant itself, `nextBoundary` steps to the following year (the
existing helper treats a boundary exactly at *now* as already passed and rolls
forward), so on 1 September 2027 the current-year key becomes 2027 and the
coming-year key 2028 — the horizon advances the moment the boundary is crossed,
with no special case.

## What is stored, and where

**One nullable integer on `OrgMembershipProcess`: the membership year that
settlement bought.** Call it `appliesToYear`, the same field name programs use.

It goes on the process, not on `OrgMembership`, because the process is the record
of a single settlement — one purchase, one grant, one renewal — and "which year
did this buy" is a fact about that settlement, not about the household's
membership as a whole. A household accumulates settlements over years; its
coverage horizon is read off the settlement that bought the furthest year, which
is exactly what the current query does when it looks for a process settled for
the coming year. Storing the year on the membership would force a choice between
overwriting last year's answer and inventing a per-year sub-record the process
table already is.

**Nullable during rollout, and never made NOT NULL by this design.** Legacy rows
predate the column and cannot all be given a value they never recorded — the
backfill can compute a year only where today's logic can (see the migration
file). A NOT NULL constraint would need a value for rows that have none. The
column stays nullable; the readers treat a null year as "not settled for the
coming year", which is the safe reading and preserves today's behaviour for any
row the backfill cannot resolve. Tightening to NOT NULL is a later contract-stage
step gated on the backfill reaching completeness, not part of this change.

The column is tier `@sensitivity:public` — it is a year integer, the same tier as
every other scalar on the process that describes the membership rather than the
person.

## How the year is set on every settlement path

The process's `appliesToYear` is the single source of truth. The purchased
variant and the grant are *inputs* that set it; nothing reads the variant again
afterwards to re-derive the year.

### Shopify purchase → variant → year

Each membership year has its own Shopify variant (see
[Settings and catalogue](#settings-and-catalogue-per-year-variants)). The paid
webhook already knows two things: the `Membership_Process_ID` cart attribute that
says which process to credit, and the order's line-item variant ids, which it
checks to confirm the order actually contains a membership product
(`checkin-app/src/app/api/webhooks/shopify/route.ts`, and `activateByProcessId`
in `checkin-app/src/lib/membership/payment.ts`).

The change: the membership line item's variant id is looked up in the
variant-to-year mapping, and the resulting year is stamped on the process as it
activates. The variant the family actually checked out through *is* the
statement of which year they bought — a family buying in June through the
current-year variant gets the current year stamped, regardless of when their
review later clears. This is the fix to the #1655 case at its root: the year is
no longer a function of review latency.

A paid order whose membership variant is not in the mapping is a
misconfiguration, not a guess to paper over: it is surfaced the way an unmatched
membership payment is surfaced today rather than being stamped with an inferred
year — it flows to the existing unmatched-payment path.

### Board grant or comp → stamped at grant

A board grant settles a household's membership with no Shopify order and no
`paidAt`, and it states the year directly since there is no variant to read:

- **Outside the renewal-window overlap**, the year is unambiguous — there is
  exactly one membership year a settlement made now would sensibly buy — so it is
  stamped automatically with no prompt. A grant made in, say, February buys the
  current year; the board is not asked.
- **Inside the renewal-window overlap**, both the current year and the coming
  year are plausible (a grant now could be completing this year's membership late,
  or granting next year's early), so the board is asked which year the grant is
  for, and their answer is stamped.

The overlap window is the existing renewal window (`renewalWindow` /
`renewalSeasonWindow`) — the span, opening a set period before the boundary,
during which renewals are in season. The only remaining detail is a test pinning
the boundary-instant edge; on a concurrent grant inside the overlap the shorter
grant wins (below).

#### The two grant buttons collapse to one

The grant surface today is two buttons on the households ops page, both posting to
`POST /api/membership-ops/households`:

- **Grant Membership** (`active: true`) — a blunt override on a non-member that
  flips `OrgMembership.status` straight to ACTIVE by upsert. It **creates no
  `OrgMembershipProcess`**, records no certification reason, and has no year.
- **Grant for coming year** (`comingYear: true`) — offered only in renewal season;
  delegates to `grantRenewalPayment`, which completes an already-in-flight RENEWAL
  at PENDING_PAYMENT through the real settlement path and requires a reason. It
  produces an ACTIVE process — the one that, under this design, carries
  `appliesToYear`.

**Why they are two, spelled out.** The horizon function reads coverage in two
layers: an ACTIVE membership is covered to the next boundary *by its status
alone*, and it reaches the boundary *after* that only when a process exists with
`appliesToYear` = the coming year. The blunt `active: true` toggle sets status and
writes no process — so it can express exactly one thing, "covered to the next
boundary", i.e. the **current year**. It has no way to grant the coming year,
because granting the coming year *is* writing that process. That is the entire
reason the season-only second button was added: it is the only path that produces
the process the coming-year horizon needs.

**What breaks if the toggle is left as-is under this design.** Nothing silently
mis-computes for a *current-year* grant — status alone still yields the right
horizon. The breakage is twofold and concrete:

- **The buttons cannot be unified, and the toggle cannot be widened safely.** If
  someone later offered the blunt toggle to a member in season meaning to grant
  the coming year, it would set ACTIVE with no coming-year process — silently
  granting the *current* year instead. The wrong outcome would look like success.
- **Two divergent record shapes for the same act.** One grant leaves a
  year-stamped, reasoned settlement (the process); the other leaves a bare status
  flip with no year and no reason. Audit, the renewal sweep's "handled this cycle"
  read, and any future per-year accounting then have to special-case a grant that
  carries no year.

**So the two collapse into one "Grant membership" that always settles through a
process carrying `appliesToYear`** — auto year outside the overlap, current-vs-
coming prompt inside. The current-year grant stops being a bare status upsert and
becomes a settlement like every other, so every grant leaves one uniform record.
Doing the merge in this change is cleanest; if it is deferred, the `active: true`
branch still cannot stay as a status-only flip once the year readers land — it
must route through the settlement path or be disabled.

**The overlap prompt races to the shorter grant.** Inside the overlap two actors
can act on one household at once — one granting (or the family buying) the current
year, another the coming year. On a race the **shorter coverage wins**: the
outcome settles to the current year (the summer), never the coming one. The actor
who saw and chose the shorter grant gets exactly what the UI showed them, and the
conservative coverage is the safe one to land on a tie — extending a family a year
they did not clearly buy is the worse error. The grant that stamps the coming year
therefore yields to a concurrent current-year settlement rather than overwriting
it.

Residual mechanics the merge settles — whether a reason is always required (the
coming-year path requires one; make the unified grant require one too), and how a
grant on a household with no in-flight process creates one to settle, since
`grantRenewalPayment` today only *completes* an existing PENDING_PAYMENT renewal —
are build details, not open design questions.

## Settings and catalogue: per-year variants

Today `BoardSettings.orgMembershipVariantId` is a single evergreen variant id
(schema ~line 624; the checkout link is built from it server-side). This design
replaces it with a **new table, one row per membership year** — each year's
membership product sold through its own variant.

**A row per year, never a column per year.** The mapping is its own table keyed
by the year's integer, so rolling a new year is inserting one row — the
`BoardSettings` schema is never touched again for this, and in fact shrinks once
the two evergreen scalars retire (below). A column-per-year, or a growing set of
`orgMembershipVariant2026Id` fields, is exactly what this avoids.

```
MembershipYearVariant
  membershipYear    Int     @unique   // the opening-year key: 2026
  shopifyVariantId  String            // the Shopify variant sold for that year
  productUrl        String?           // optional, same role as today's product URL
```

A table rather than a JSON map on `BoardSettings` (both avoid a per-year column)
because the reconcilers below ask "is this line-item variant *any* membership
year's variant" — a keyed `where variant in (…)` query the table answers
directly, where a JSON blob would have to be loaded and parsed at every match
site. It also matches how programs already carry per-program variant ids, so it
reads like the rest of the catalogue.

- **Checkout** builds the link from the row for the year being sold. In the
  overlap window both years are on sale; outside it, the current year.
- **Rolling a new year** is inserting that year's row before its renewal window
  opens — an ops step, parallel to setting up any year's catalogue. This is the
  operational task that replaces "the evergreen variant just keeps working".
- **The two evergreen `BoardSettings` scalars** (`orgMembershipVariantId`,
  `orgMembershipProductUrl`) become the current year's row at backfill, then are
  dropped at the contract stage once every reader is on the table. Net schema
  change over time is one table added and two columns removed — not a settings
  table that grows each year.

### How the table is shown, and the renewal hard stop

The rows persist for every year ever sold, but the settings surface renders only
the years **in play**, and which those are is *derived from the boundary, never
stored* — the same principle as the year integer itself. At any instant the
editable surface shows exactly two: the **current** year (still sellable to a late
joiner) and the **coming** year. Past years' rows stay in the table — settled
processes reference them through `appliesToYear`, and the reconcilers match old
orders against them — but they drop off the editable surface once they become
past. Nothing is deleted; a year simply stops rendering when the boundary crosses.

**The coming-year slot appears roughly twelve months ahead, on its own.** A year
becomes "coming" the moment the previous boundary passes, so its row is visible
for the whole year before its renewal window opens — no lead-time setting, and far
more warning than the window needs. Until it is filled it renders as an **empty
slot with a red "needs variant" badge**, and it feeds the existing
`settingsMisconfig` nav pill (which already counts unset required checkout
settings), so the board is nagged to enter it well before it is needed.

**The renewal sweep hard-stops on the missing coming-year variant.**
`runRenewalSweep` already refuses when no boundary is configured; it gains a
second early return of the same shape: **with no coming-year variant row, it opens
no renewals and reports the gap**, because a renewal it opened could not be paid —
there would be no product to check out through. The board sees the same gap twice
before it bites: the empty-slot badge and the nav pill, both live for months, and
then the sweep's own refusal reason. Building a coming-year checkout link is
fail-closed for the same reason — an in-window renewal attempted before the
variant exists is surfaced, not left as a silent dead end.

When the boundary crosses, this rolls forward with no intervention: the coming
year becomes current, a fresh empty coming-year slot appears, and its badge starts
asking to be filled for the next cycle.

### Impact on the drift reconcilers (#625 / #1293 / #1349)

The finance reconcilers (`checkin-app/src/lib/finance/reconcile.ts`,
`matchAudit.ts`) match a paid Shopify order to a membership settlement by
comparing its line-item variant against the single `orgMembershipVariantId`. With
one variant per year, "is this a membership order" becomes "is this line item
*any* membership year's variant" — the match set widens from one id to the set of
ids in the mapping. Every place that reads `orgMembershipVariantId` as a scalar
(the settings route, the nav todo-counts misconfig check, the dev mock, the
reconcilers) has to move to the set. Missing one leaves a reconciler that matches
only the year whose id happens to still be in the old field — a silent
undercount. The full consumer list is in the migration file; this is the part of
the change with the widest blast radius, and it is the reason the reconciler
drift issues are cross-referenced here rather than treated as separate work.

## The deletion this enables

With the year recorded, the timestamp inference collapses. In
`checkin-app/src/lib/membership/lifecycle.ts`:

```
settledThisCycleWhere(windowStart)   →   { status: "ACTIVE", appliesToYear: comingYear }
handledThisCycleWhere(windowStart)   →   { status: { in: ["ACTIVE","ARCHIVED"] }, appliesToYear: comingYear }
```

Both lose the `windowStart` parameter and the `stageEnteredAt` clause entirely.
They take the coming-year integer, computed once per request from the boundary.
`paidAt` never enters — the interim `paidAt`-fallback band-aid is not built (see
[Alternatives](#alternatives-considered)).

A behaviour change falls out of this and is intended: coverage stops being gated
on the season. Today, out of season the window start is `MAX_DATE`, so
`settledThisCycleWhere` matches nothing and a family that pre-bought next year
still reads as un-settled until the window opens. Keyed on `appliesToYear`, a
family that bought the coming year reads as settled for it *whenever* that
purchase exists — which is precisely the off-season leak the issue calls dormant,
now closed from the correct direction.

Every consumer and test that moves:

| Site | Change |
|---|---|
| `src/lib/membership/lifecycle.ts` — `settledThisCycleWhere`, `handledThisCycleWhere` | Reshaped to the `appliesToYear` form above; signatures take a year, not a `windowStart`. |
| `src/app/api/membership-ops/households/route.ts` (two call sites: the detail `findFirst` and the list `include`) | Pass the coming-year integer; the surrounding window/`MAX_DATE` plumbing for these probes goes. |
| `src/lib/orgMembership.ts` — `membershipValidThrough` | Same; the `settledThisCycleWhere` call keys on the year. `duesSettledAwaitingBg` (the paid-awaiting-BG horizon) is untouched — it is a status/`paidAt` set, not a cycle probe. |
| `src/lib/membership/renewal.ts` — `runRenewalSweep` skip-test | The `handledThisCycleWhere(windowStart)` arm of the sweep's process probe moves to the year key. Confirmed: this is the same fragment, so the skip-test moves with the money horizons — the three readers stay in lock-step, which is the invariant the current docblock asserts. |
| `src/lib/membership/personAgreementTriggers.ts` — the local `handledThisCycleWhere(personId, floor)` | **Left alone — out of scope.** It shares only the function name; it dedups the adult-child yearly-agreement trigger, keyed on `stageEnteredAt ≥ floor` for `PERSON_AGREEMENT`. A signature satisfying a cycle is not a settlement buying a year, so it keeps its `stageEnteredAt` floor and this design does not touch it. |
| `src/lib/membership/__tests__/lifecycle.test.ts` | The two `toEqual` fragment assertions for `settledThisCycleWhere` / `handledThisCycleWhere` rewrite to the year shape. |
| `src/lib/membership/__tests__/renewal.test.ts` | The `handledThisCycleWhere(windowStart)` assertion in the sweep test rewrites. |
| `src/app/__tests__/householdsListGrantableAPI.integration.test.ts` | The "settled this cycle" / "handled this cycle" probe expectations move to declared-year fixtures. |
| `src/__tests__/lifecycleStatusLiteralAllowlist.test.ts` | References `handledThisCycleWhere`; check whether the reshape touches the allowlisted literals. |

## Backfill of live production data

There is real production data, and no reset. The rollout is additive first, then
a one-time backfill, then the readers switch — the standard expand path from
`checkin-app/docs/DEPLOY_MIGRATION_ORDER_OF_OPERATIONS.md`, kept safe across the
rolling-deploy drain window because old code ignores the new column and the new
readers only switch on once the column is populated. The exact sequence is in the
migration file. The backfill computes each existing relevant process's year
**once**, from today's logic (the year the process's `stageEnteredAt` fell into,
matching what `settledThisCycleWhere` would answer), and stores it — freezing
today's answer for rows already decided, so no live horizon shifts under a family
at cutover except the summer-leak case this design exists to correct.

## Reconciliation with program fiscal year (#1484)

Issue #1484, already designed in `docs/in-design/PROGRAM_MEMBERSHIP_YEAR.md`,
makes a **program** declare the membership year it runs in, as an integer named
against the same boundary. That design and this one describe **one first-class
concept — the membership year — with one shared representation**: the integer
keyed to the boundary that opens the year, and the shared boundary math in
`checkin-app/src/lib/programYear.ts`.

They are deliberately **stored on different subjects**, because they answer
different questions:

- A program's `appliesToYear` says *which year this program runs in* — a property
  of the program's schedule, set when the program is created.
- A settlement's `appliesToYear` says *which year this purchase bought* — a
  property of the transaction, set when it settles.

Member pricing is where the two meet: a program priced for members requires the
household's dues to cover *the membership year the program runs in*. Program
design already frames coverage that way ("Member pricing requires the household's
dues to cover the membership year the program runs in, not the program's own
dates"). This design supplies the other half — a reliable record of which years a
household's dues have actually covered — so the pricing check becomes *does a
settlement exist with `appliesToYear` = the program's `appliesToYear`* rather than
a date-range overlap.

**Recommendation:** treat the membership year as one shared concept with one
representation and one field name (`appliesToYear`) on both subjects, sharing the
boundary/year helpers, and keep two columns because the two facts are set at
different times by different actors. Do not merge them into a single table.
`docs/in-design/PROGRAM_MEMBERSHIP_YEAR.md` already rejected "model membership
years as rows" for the program side, and the same reasoning holds here: the
boundary defines the years completely, so a table would be a second source of
truth for a span two integers describe. This design does not design #1484; it
adopts its representation and cross-links it.

## Decisions (previously open)

The product owner has settled these; recorded here so they are not re-opened.

- **One year per settlement.** A purchase or grant buys exactly one membership
  year — no multi-year purchase. `appliesToYear` is a single integer, full stop.
- **No proration in software.** Prorating a partial year's cost is done with
  Shopify discounts. The app does not model it; the year field carries no
  partial-coverage marker.
- **Overlap race resolves to the shorter grant.** Two concurrent grants on one
  household in the overlap settle to the current year (the summer), never the
  coming one — see [the grant section](#the-two-grant-buttons-collapse-to-one).
  The overlap span is the existing `renewalWindow`; the only remaining detail is a
  test pinning the behaviour at the boundary instant.
- **Refunds and wrong-year stamps are handled by people, not machinery.** A
  refunded settlement is not auto-unwound and no skipped renewal auto-re-opens —
  the board settles it with the family, exactly as it does a place bought at the
  member rate that a later background-check rejection does not claw back
  (`docs/rules/membership.md`), and consistent with the standing Assumption that
  refunds are handled outside the app. A genuinely wrong `appliesToYear` (rare) is
  a board/sysadmin manual correction; a mis-mapped variant never stamps a guess in
  the first place (below).
- **A misconfigured membership variant flows to the unmatched-payment path.** A
  paid membership order whose variant is in no year's mapping is surfaced exactly
  as any unmatched membership payment is today — it is not stamped with an
  inferred year.

## Open questions

None of design substance remain. What is left are build-time mechanics with a
decided direction, not open questions:

- The unified grant should always require a certification reason (the coming-year
  path already does).
- A grant on a household with no in-flight process must create one to settle,
  since `grantRenewalPayment` today only completes an existing PENDING_PAYMENT
  renewal. Whether the merge lands in this change or as a fast follow is a
  sequencing call; either way the `active: true` status-only flip cannot remain
  once the year readers land.

## Alternatives considered

**Use `paidAt` instead of `stageEnteredAt` (the interim band-aid).** Explicitly
rejected by the product owner. It answers "when did the money move" rather than
"which year was bought", still infers the year from a timestamp, and is null for
granted or comped settlements — so it would need its own fallback for exactly the
board-grant path this design has to handle anyway. It also only narrows the leak
window rather than closing it, and the leak is dormant off-season, so the
band-aid buys little and postpones the real fix.

**Keep a single evergreen variant and record the year by a UI-only choice at
checkout.** Rejected: the product owner has decided a per-year variant will
exist, and a per-year variant is a stronger statement of intent than a UI toggle —
the variant the family actually paid through is unforgeable evidence of which
year they bought, whereas a client-side choice can drift from what was charged.

**Store the year on `OrgMembership` rather than the process.** Rejected above: a
household accumulates settlements, and "which year did this buy" is a fact about
one settlement, not the membership. The process table already is the per-year
sub-record.

**Store a coverage-through date on the settlement instead of a year integer.**
Rejected for the same reason program design rejected it: a stored date is a stale
copy of the boundary setting the first time the board moves the boundary. The
integer re-resolves.

## Appendix: provenance

Root cause behind issue
[#1655](https://github.com/innovationtreehouse/checkin/issues/1655) (membership
year ambiguity: `stageEnteredAt` vs `paidAt` for in-window INITIALs), which
records the timestamp inference as a `KNOWN LIMIT`. Shares its representation with
[#1484](https://github.com/innovationtreehouse/checkin/issues/1484) (programs
declare their fiscal year), designed in
`docs/in-design/PROGRAM_MEMBERSHIP_YEAR.md`. The per-year variant shape relates to
the membership-segment pricing and legacy-variant work
(`checkin-app/docs/designs/SHOPIFY_MEMBER_SEGMENT_PRICING.md`,
`checkin-app/docs/designs/975-LEGACY_VARIANT_CONTRACT.md`) and to the variant
drift issues #625, #1293, and #1349.
