# Attendance / Visit / Hour Correction Surface

**Backlog:** AT3 (visit management for staff) + AT5 (user self-correction of own
hours) + AT12 (admin correction-review screen), designed as **one** surface.
AT13 (visit-edit UI/API gate mismatch) falls out of the permission matrix and is
answered here.

**Status:** design. No production code accompanies this doc.

## Why one design, not three

All three sit on a single substrate: **a permission matrix over the visit-edit
model**. A `Visit` is the only stored attendance fact; "hours" are a *derived
read* over visit durations, never stored. So:

- **AT3** decides who may insert / edit / delete *whose* visits.
- **AT5** ("correct my hours") has no stored hours to write — it resolves to
  editing an underlying `Visit`. It is the `self` (and household-lead) row of the
  AT3 matrix plus the self-scoped edit path that does not exist today.
- **AT12** is the oversight half: corrections land only as `AuditLog` rows today;
  AT12 aggregates them. Its shape is determined by what AT3/AT5 write to the
  audit trail.

Designed apart, the matrix and the audit contract fragment. One doc.

## Terminology: the visit-source model

Every `Visit` records *how* its arrival and departure were captured, in
`arrivedVia` / `departedVia` (`VisitSource`). This design uses **five** sources
with non-overlapping meaning:

| source | on | meaning | departure accuracy |
|---|---|---|---|
| `SCANNER` | both | physical kiosk badge — **measured** | exact |
| `WEB` | both | dashboard / self-service entry — **self-reported** | member's own claim |
| `LEAD_MARKED` | both | staff asserted presence — a post-hoc roster mark that creates a **full** visit (arrival + departure at the event window), no badge involved | event window, not real |
| `FACILITY_CLOSE` | `departedVia` | the building closed (last keyholder badged out) while the member was still checked in — departure stamped at the **close moment** | plausible: bounded by building hours |
| `AUTO_CLOSE` | `departedVia` | the nightly cron swept an abandoned open visit — departure stamped at **cron-run time** | poor: the member may have left hours earlier |

Domains: `arrivedVia ∈ {SCANNER, WEB, LEAD_MARKED}`,
`departedVia ∈ {SCANNER, WEB, LEAD_MARKED, FACILITY_CLOSE, AUTO_CLOSE}`.

`LEAD_MARKED` is not arrival-only: marking someone present has no badge times, so
the writer fabricates a **closed** visit stamping *both* fields (a null departure
would mark it "open" and trip the nightly auto-checkout + the one-open-visit
index). Both fields are staff assertions, so both read `LEAD_MARKED`.

**This splits today's overloaded `SYSTEM`.** Current code collapses *three*
unrelated events into one value `SYSTEM`:
- the post-hoc roster mark (both fields) → `LEAD_MARKED`;
- the keyholder building-close sweep (`closeAllOpenVisits`,
  [scan-service.ts:159](../../src/lib/scan-service.ts)) → `FACILITY_CLOSE`;
- the nightly-cron abandoned-visit sweep
  (`processVisitCheckout(…, "SYSTEM")`, [cron/nightly:28](../../src/app/api/cron/nightly/route.ts))
  → `AUTO_CLOSE`.

Splitting `FACILITY_CLOSE` from `AUTO_CLOSE` is **not cosmetic** — no checkout
path writes a `Visit` audit row, so `departedVia` is the *only* record of how a
visit closed, and the two machine closers have opposite accuracy (see §2). A
two-name rename would fuse them permanently; the third value is what lets the
board tell "the building closed while you were badged in" from "you were still
badged in at midnight", and lets the significance flag treat their corrections
differently. `LEAD` is the accepted umbrella — the roster-mark gate is lead-mentor
OR sysadmin/board/keyholder, and there is no "staff" concept in this codebase's
vocabulary. The split is a migration + reference sweep, folded into AT3 (§3); the
rest of this doc is written in the target vocabulary.

---

## Validated current state

Confirmed against live code (`origin/main` @ `4e17af5a`). Where this says
`SYSTEM`, that is the current on-disk enum value the Terminology section renames.

### Self-insert own past visit — **EXISTS**
`POST /api/attendance/manual`
([route.ts](../../src/app/api/attendance/manual/route.ts))
- `personId` forced to `auth.user.id` (line 107); never from the body — not an
  IDOR by construction.
- Backdate allowed arbitrarily far; future arrivals rejected past a 5-min skew
  clamp (lines 42–47). Open (no-departure) backfill restricted to today / last 6h
  (lines 65–71).
- Per-person advisory xact lock + one-open-visit re-check (lines 81–103) — same
  race guard as `/api/scan`.
- Audit `CREATE` on `Visit`, `newData.type = "manual_entry"` (lines 142–150).
- `arrivedVia = "WEB"` marks it self-reported, not measured.

The route's header comment states the posture explicitly: arbitrary backdate is
accepted on purpose, self-reported hours are **not a security boundary**, the
board reconciles against the audit trail. That posture anchors the AT5 model.

### Self-EDIT own visit — **NONE**
The manual route is `POST` only. No self-scoped `PATCH`/`DELETE` exists. This is
the gap AT5 fills.

### Staff edit — **EXISTS, with a UI/API gate mismatch (AT13)**
`GET/PATCH/DELETE /api/facility/visits`
([route.ts](../../src/app/api/facility/visits/route.ts)) gate
`roles: ['isSysadmin', 'isBoardMember']`.
- `PATCH` edits `arrivedAt`/`departedAt`, re-validates order + 24h max, forbids
  reopening a closed visit, audit `EDIT` (lines 30–98).
- `DELETE` **hard-deletes** the row, keeping it only in audit `oldData`
  (lines 100–137). This design replaces that with a tombstone — see §3.

The UI page
([facility-ops/visits/page.tsx:66](../../src/app/facility-ops/visits/page.tsx))
gates `useRequireRole(['isSysadmin'])` — **board can hit the API but has no
page**. That is AT13, being fixed in
[PR #1350](https://github.com/innovationtreehouse/checkin/pull/1350); this design defines
the target gate that fix should align to (§1).

### Lead / ops add-for-others — **EXISTS, scoped**
`POST /api/events/[id]/attendance`
([route.ts](../../src/app/api/events/[id]/attendance/route.ts))
- Gate: program `leadMentorId` **or** sysadmin/board/keyholder (lines 27–32).
- Targets restricted to the program roster (enrolled + volunteering); unknown ids
  rejected (lines 41–61) — no cross-program fabrication.
- Writes synthetic `LEAD_MARKED` (today `SYSTEM`) visits spanning the event window
  (lines 134–143), or adopts an overlapping walk-in into the event. Audited.
- **No arbitrary-past-time insert for others** exists. `/api/scan`
  ([route.ts](../../src/app/api/scan/route.ts)) is `withKiosk`, live-only,
  `personId` from the badge — not a staff-for-other path.

### Hours — derived read, roster-marks excluded
`GET /api/facility/trends`
([route.ts](../../src/app/api/facility/trends/route.ts)), gate sysadmin/board.
Hours = `Σ (departedAt − arrivedAt)` over visits, bucketed. Excludes
`arrivedVia = LEAD_MARKED` (today `SYSTEM`, line 94) — a roster mark is a
placeholder window, not measured time. No stored-hours column exists; the only
thing to correct is the underlying visits. Keep the exclusion.

### Audit substrate — already present
`AuditLog` (schema line 1083): `actorId`, `action` (CREATE/EDIT/DELETE),
`tableName`, `affectedEntityId`, `secondaryAffectedEntity`, `oldData`, `newData`.
A generic viewer exists at `/system-status/audit-log` (gate **isSysadmin-only**),
filterable by `tableName`/`action`/date. This is AT12's foundation (§4).

Audit coverage across visit-write paths (verified): the human correction routes
all log a `Visit` audit row — manual `CREATE`, `facility/visits` `EDIT`/`DELETE`,
events-attendance, `my-programs/conflicts/resolve`, `membership-ops/.../merge`.
The automated / baseline paths do **not** — kiosk `scan`, the `attendance`
check-in (writes only a `SYSTEM_NOTIFY` row), and **both** machine closes
(`FACILITY_CLOSE` via `closeAllOpenVisits`, `AUTO_CLOSE` via
`processVisitCheckout`). That the closes are unaudited is exactly why
`departedVia` must carry the close provenance itself — it is the only record of
how a visit closed. Those paths aren't corrections, and AT12 aggregates
corrections, so leaving them unaudited is fine. The design commitment is that
**every human edit path
logs** — including the new self and household-lead paths.

### Roles available
`BusinessRole = isSysadmin | isBoardMember | isKeyholder |
isBackgroundCheckReviewer | isOperations`
([types/auth.ts](../../src/types/auth.ts)). Program-lead is per-program
(`event.program.leadMentorId`). Household-lead is a household-leadership relation,
**not** a `BusinessRole` flag. `isOperations` exists but is not on any visit-edit
gate today.

---

## 1. Permission matrix

Rows = actor, cols = action. "own" = `personId === actor`; scope words name the
target set the actor may act on. The **correct-hours** column always resolves to
editing an underlying visit — there is no separate hours write.

| actor | insert own-past | insert for-others | edit a visit | delete a visit |
|---|---|---|---|---|
| **self** | ✅ `personId` forced self | ⛔ `personId` never from body | ✅ own visits — any field; significant changes flag (§2) | ✅ own visits (tombstone; delete flags) |
| **household-lead** | ✅ (as self) | ✅ own household members | ✅ household members' visits, same as self | ✅ household members' visits (tombstone) |
| **program-lead** | ✅ (as self) | ✅ program roster (synthetic mark at event window) | 🟡 visits associated to their program's events — *target, not built* | 🟡 same program-event scope — *target* |
| **ops** (`isOperations`) | ✅ (as self) | 🟡 facility-wide — *gate widen, §6* | 🟡 facility-wide — *gate widen, §6* | 🟡 facility-wide — *gate widen, §6* |
| **board** | ✅ (as self) | ✅ facility-wide | ✅ facility-wide (API exists; **UI missing = AT13**) | ✅ facility-wide (tombstone) |
| **sysadmin** | ✅ | ✅ facility-wide | ✅ facility-wide | ✅ facility-wide (tombstone) |

✅ = allowed (exists today unless noted) · 🟡 = target/open · ⛔ = deny by design

**Enforcing boundaries:**
- `self` insert-for-others deny is structural (`personId` forced, never from the
  body). Keep it.
- `self` / household-lead edits are **not gated** by the value's source — the
  source only weights significance for post-hoc flagging (§2). The only edit-time
  checks are validity (no future times, departure after arrival, ≤ 24h).
- household-lead target scope = household membership, resolved server-side (never
  a `personId` from the body).
- program-lead scope = roster membership (reuse the enrolled + volunteering set
  the events route already computes) **and** the visit's `associatedEventId`
  belonging to that program.
- ops / board / sysadmin facility-wide = the `withAuth` role gate on the route.

### AT13 — answer (fix in flight: PR #1350)
The matrix puts board at **allow** for edit + delete, and the API already grants
it. So **board should have the edit UI.** The fix is to align the page gate to
the API gate; the two role sets must stay equal. AT13 is precisely "they drifted
apart", and the matrix is the single source that re-couples them. PR #1350
carries the fix — it must land on whatever set the matrix blesses (below), not a
narrower one:

```
useRequireRole(['isSysadmin'])              // today — wrong, drops board
→ useRequireRole(['isSysadmin', 'isBoardMember'])   // matches the API
```

If ops is added to the visit-edit gate (§6), the same set widens on both the
route (`withAuth roles`) and the page (`useRequireRole`) together.

---

## 2. AT5 — self-correction model

**Model: trust-first. A member edits or deletes any of their own visits directly
— no permission ask, no justification required. Integrity comes from post-hoc
oversight: the system *flags significant changes* to the board (and, for another
person's observation, potentially that observer) for async review. Nobody is
blocked; big changes are simply made visible.**

This is the posture the codebase already takes — the manual-insert route's own
comment: self-reported hours are *not a security boundary*, the board reconciles
against the audit trail. People act in good faith; the rare bad or mistaken edit
is caught by review after the fact, not by a gate in front of everyone.

Rejected alternatives:
- **Append an `AttendanceAdjustment` record.** The original is already preserved:
  `AuditLog.oldData` snapshots every pre-edit state, and the source enum marks
  self-reported vs measured. An adjustment table duplicates the audit trail and
  forces `trends` to sum visits *plus* overlays — more model, more read
  complexity, no new information.
- **Per-field locks + a request/approval queue.** Gating good-faith edits behind
  staff sign-off is the wrong tone and wastes human time: nobody should review a
  15-minute nudge, and a *required* "reason" reads as distrust — like asking why
  a plate broke and being told "gravity." Non-answers, friction, no signal.
  Replace the gate with a **signal**: let the edit through, and flag it only when
  it's big enough to be worth a human's attention.

### The member's own visits are theirs to fix

Extend the self-service surface from INSERT-only to INSERT + EDIT + DELETE,
scoped to the member's own visits (and, for a household-lead, their household
members' — §3). **No field is locked.** A member can correct a `SCANNER` arrival,
an `AUTO_CLOSE` departure, or a `LEAD_MARKED` visit alike — the source of the
value they're changing does not gate the edit, it only weights how significant
the change is (below). No reason field.

### Significance: what gets flagged

A flag is raised **after** the edit lands, when the change is large *relative to
how authoritative the value it overwrote was*. Two inputs:

- **Source trust-weight** — how much we trust the old value. Highest for
  `SCANNER` (a physical measurement), then `LEAD_MARKED` (another person's
  observation of the member), then `WEB` (the member's own prior self-report).
  Lowest — effectively *expected to be wrong* — for the machine closes
  `FACILITY_CLOSE` and `AUTO_CLOSE`: those are placeholder departures the member
  is *meant* to fix. Editing your own self-report is nearly free; overwriting a
  measurement or someone else's observation is where scrutiny belongs.
- **Magnitude** — the size of the change in counted hours / minutes shifted. A
  small delta is noise; a large one moves the numbers.

**significance ≈ magnitude × source-weight**, over a threshold. A delete has a
**floor** — erasing a record is inherently notable even at low weight, so a
member deleting a visit they themselves submitted still surfaces (we want to see
that), and deleting a `SCANNER`/`LEAD_MARKED` visit flags strongly.

**The machine-close exception (why the third enum value earns its keep).** A
correction to a machine-stamped departure is expected *by construction*, so
magnitude alone would invert the intent — `AUTO_CLOSE` (cron) stamps at cron-run
time, so the member's real leave can be hours earlier and the correction is
**large**, which under a plain magnitude rule would fire the *loudest* alert for
the *least* trustworthy guess. That is backwards. Because `departedVia` now
distinguishes the two closers, the rule is expressed on the **source**, not the
size: **a correction whose overwritten departure was `AUTO_CLOSE` or
`FACILITY_CLOSE` does not flag on magnitude** — we already know that time was a
placeholder. (`FACILITY_CLOSE` corrections are small anyway — bounded by building
hours — but keying on the source, not the delta, is what makes the `AUTO_CLOSE`
case correct.) Fixing a machine close is the happy path, never a board alert.

| change | weight of old value | flagged? |
|---|---|---|
| +5 min on own `WEB` arrival | low | no — noise |
| fix an `AUTO_CLOSE` (cron) departure to the real leave time | machine placeholder | **no — source-suppressed, even a 10 h correction** |
| fix a `FACILITY_CLOSE` departure | machine placeholder | no — source-suppressed (and small anyway) |
| shift a `LEAD_MARKED` visit by 15 min | high | no — small delta, not worth a human |
| move a `SCANNER` arrival 2 h earlier | high | **yes** — overwriting a measurement, big delta |
| delete a `LEAD_MARKED` or `SCANNER` visit | high | **yes** — strong |
| delete an own submitted `WEB` visit | low | **yes** — delete floor: we should see it |

Thresholds are **tunable config** (BoardSettings-style), not hardcoded — the
right cutoffs are a judgment the board will calibrate against real volume; leave
the knob (§6). The machine-close suppression is a source rule, not a threshold.

### Mechanics (reuses what exists)
- Add `PATCH`/`DELETE` to `/api/attendance/manual` (or a sibling
  `/api/attendance/self`). `personId` forced to self (or a household member's id
  for a household-lead). Reuse the existing validation helpers (`parseVisitTime`,
  `departureAfterArrival`, `withinMaxDuration`) and the advisory-lock +
  one-open-visit guard from the existing `POST`.
- The edit **always applies** (subject only to those validity checks — no
  future times, departure after arrival, ≤ 24h). No source gate, no approval.
- Delete is a **tombstone**, not a row removal (§3) — so a flagged delete is
  reviewable *and* reversible.
- Compute `significance(old, new, source)`; if over threshold, fire an internal
  notification to the flag recipients (below) — fire-and-forget, never blocking
  the member's response.
- Audit `EDIT`/`DELETE`, `actorId` = the acting user, `newData.type =
  "self_correction"`, plus a significance marker so AT12 can filter to the
  flagged ones without re-deriving (§4).

### Who gets flagged (scope — decision owed)
Default recipient: **board**. For a `LEAD_MARKED` change, the lead who made the
observation is a natural additional recipient — their assertion is being
overwritten. Ops may want facility-wide visibility. The exact recipient set per
change-type is an open decision (§6) — the mechanism (a fire-and-forget notify +
an AT12 lens) is the same regardless of who's on the list.

### No new model
The flag is a **notification + an AT12 filter**, not a workflow object.
Significance is computable from the audit row's old/new values, so AT12 recomputes
and filters "significant only" straight from the audit trail — no request table,
no PENDING/APPROVED state machine, nothing to approve. (If the board later wants a
reviewed/acknowledged worklist rather than just a feed, add a light ack state
then — YAGNI until they ask.)

**"Correct my hours" UI** resolves to: show the member their own visits (already
possible via the manual-entry surface); every field is inline-editable; a
significant save just goes through, with the flag raised quietly behind it.

### Abuse: it's audited, and the big moves are seen
The manual-insert route already accepts that a member can inflate their own
self-reported hours — they could already do it by inserting fictitious `WEB`
visits. Opening edits doesn't widen that ceiling; it just makes correcting a real
mistake as easy as making one. **No backdating time-cap** — the control is the
audit trail plus the significance flag, not a time fence:
- Every edit and delete is audited (`actorId`, `oldData`, `newData`).
- Large or high-trust-overwriting changes flag to the board in real time.
- `trends` excludes `LEAD_MARKED`; `WEB` self-reports are visibly `WEB` in the
  visits table (source icon) — reconcilable.
- AT12 aggregates the flags, so a member whose edits flag often is a standing
  signal, not a buried audit row.

---

## 3. AT3 — staff visit management

AT3 is the non-`self` rows of the matrix.

- **Board / sysadmin facility-wide edit/delete** — exists (`facility/visits`);
  only the UI gate is wrong (AT13).
- **Household-lead act-for-members** — a household lead may insert / edit / delete
  visits for **anyone in their household**, self-serve and ungated exactly as
  `self`, with the same significance flagging (§2). The lead is the responsible
  adult, so this is self-equivalent for household members (notably minors who
  cannot self-serve). Scope = household membership, enforced server-side; audited
  with `actorId` = the lead. A lead editing a member's visit is itself a natural
  flag input — an adult changing another person's record — factored into
  significance.
- **Program-lead edit within their program** — new. The events-attendance route
  already computes the roster and owns the event scope; a program-scoped
  edit/delete reuses that authz (target `visit.associatedEventId`'s program
  `leadMentorId === actor`). Kept off the facility-wide route so the broad gate
  stays broad and the scoped gate stays scoped.
- **Insert-for-others at an arbitrary past time** — does not exist today except
  via the event-window synthetic path. For a genuine unenrolled walk-in, add a
  `POST` for-others to `facility/visits` under the staff gate (target `personId`
  from the body **is** allowed here, unlike the `self` route). Closes the gap.

### Delete = tombstone (reversible), not hard-delete
A deleted visit must stay knowable and reversible (a correction can be backed
out). Add a soft-delete marker to `Visit` (e.g. `deletedAt` + `deletedById`).
`DELETE /api/facility/visits` (currently `prisma.visit.delete`) and the new
self/household-lead delete become a soft-delete update. Every read that feeds a
user surface — `trends`, the visit lists, the one-open-visit partial index
(a tombstoned row must not count as "open") — filters `deletedAt: null`. Un-delete
restores the row. Schema addition + migration, folded into this AT3 work.

### The `VisitSource` split
The `SYSTEM → LEAD_MARKED` / `FACILITY_CLOSE` / `AUTO_CLOSE` split (Terminology)
lands as part of AT3. It is a **3-way** split — the three current `SYSTEM` writers
map to three different values, so the migration is a per-writer edit, not a blind
rename:

| writer | today | becomes |
|---|---|---|
| events-attendance roster mark ([route.ts:143](../../src/app/api/events/[id]/attendance/route.ts)) | `SYSTEM` (both fields) | `LEAD_MARKED` |
| keyholder building-close `closeAllOpenVisits` ([scan-service.ts:159](../../src/lib/scan-service.ts)) | `departedVia: "SYSTEM"` | `FACILITY_CLOSE` |
| nightly-cron sweep `processVisitCheckout(…, "SYSTEM")` ([cron/nightly:28](../../src/app/api/cron/nightly/route.ts)) | `departedVia: "SYSTEM"` | `AUTO_CLOSE` |

`processVisitCheckout`'s `source` union widens to carry the new value from the
cron call site (the SCANNER/WEB self-checkout callers are unchanged). The rest is
mechanical: schema `VisitSource`, the raw-SQL enum migration, `security/generated/
classifications.ts`, the `SOURCE_META` UI map, and the `trends` filter (which keys
on `arrivedVia`, so it is unaffected by the departure-side split). Keep it in the
AT3 PR rather than a standalone churn.

Note the existing data: today's `departedVia = "SYSTEM"` rows are the *fused*
history — they cannot be back-split into `FACILITY_CLOSE` vs `AUTO_CLOSE` after
the fact (the discriminator was never stored). The migration maps legacy `SYSTEM`
departures to one bucket (recommend `AUTO_CLOSE`, the conservative "don't trust
this time" reading); only rows written after the split carry the true
distinction.

---

## 4. AT12 — correction-review screen

**Aggregates** attendance corrections by **kind** (insert / edit / delete),
**actor class** (self vs staff), and **frequency over time**, with drill-down to
the underlying audit rows. It sees corrections only — the automated / baseline
paths don't write `Visit` audit rows (that's fine; they aren't corrections).

**Source:** `AuditLog` where `tableName = 'Visit'`. Everything already lands there
— manual `CREATE` (`type:"manual_entry"`), `facility/visits` `EDIT`/`DELETE`,
events-attendance, and the new self / household-lead `EDIT`/`DELETE`
(`type:"self_correction"`). No new model.

**Self vs staff, cheaply:** don't join `AuditLog → Visit` (the visit may be
tombstoned; `personId` isn't on the audit row). Lean on the `newData.type`
markers the write paths set — `"manual_entry"` / `"self_correction"` are self,
their absence with a staff `actorId` is staff.

**Significant-edit flags (§2) are the headline view.** The same significance
function runs at read time over the `Visit` audit rows, so AT12's default lens is
"flagged changes" — big or high-trust-overwriting edits, and deletes — with the
full correction feed behind a filter. A member whose edits flag often is a
standing signal. This *is* the "raise it to the board" surface; the write-time
notification (§2) is the push, AT12 is the pull.

**Audience:** ops + board (they reconcile). The existing `/system-status/audit-log`
viewer is sysadmin-gated and buries visit corrections among all tables — that is
the "missed screen" AT12 exists to replace.

**Build:** a read-only aggregation route `GET /api/facility/corrections` (gate
sysadmin + board + ops) grouping the `tableName='Visit'` audit rows by
kind × actor-class × period, plus a `facility-ops` page rendering counts and a
filterable list. Reuse the existing audit-log route's shape (it already filters
`tableName`/`action`/date and resolves `actorId → name`): pin `tableName='Visit'`,
add the group-by. Do not build a second generic audit browser.

---

## 5. Interactions with adjacent backlog items

- **AT1 / AT2 (inference & ambiguity) — different problem, shared field.** AT1/AT2
  decide *which event* a visit associates to when events overlap (association is
  deterministic single-match today). This surface edits a visit's
  *times / existence / who*. The seam is `associatedEventId`: exposing it as an
  editable field lets AT2's "admin resolves the overlap" reuse the same `PATCH`,
  but ambiguity **detection + resolution** is out of scope here. Boundary:
  correction = "this visit is wrong"; ambiguity = "this visit's event is
  undecided."
- **AT6 / #300 (two-deep) — no coupling.** Two-deep is a live, real-time coverage
  check at check-out. Editing a *past* visit does not and should not retro-fire a
  historical two-deep evaluation; corrections don't recompute past violations.
  AT10 (unknown-DOB fails open) is a separate live-path bug.
- **AT9 / #254 (force-close race) — shared invariant.** The facility-close sweep
  (`closeAllOpenVisits`, writing `FACILITY_CLOSE`) is itself a bulk visit-write and
  shares this surface's substrate: the one-open-visit invariant + per-participant
  advisory lock. AT9 is a race where a check-in survives the close. The correction
  surface's single-visit writes must take the **same advisory lock** so a manual
  edit can't race the sweep. Both converge on one rule — **every visit write
  (self, staff, automated) goes through the advisory-lock + one-open-visit
  guard** — while keeping the single-edit and bulk-close code paths distinct.

---

## 6. Open questions

1. **Widen the `facility/visits` gate to `isOperations`?** Ops is a
   facility-operations role and visit management is facility operations —
   recommend **yes**. If adopted, ops moves from 🟡 to ✅ in the matrix and the
   AT13 gate set becomes the 3-role set on both route and page.
2. **Significance thresholds — the actual cutoffs.** The model is
   magnitude × source-weight over a threshold (§2); the numbers are a board
   judgment. What delta on a `SCANNER` value flags? What's the `WEB` cutoff (or is
   own-`WEB` never flagged short of a delete)? What's the delete floor per source?
   Ship tunable config with sane defaults; calibrate against real volume.
3. **Flag recipient scope.** Default board. Per change-type: does a `LEAD_MARKED`
   overwrite also notify the observing lead? Does ops get facility-wide flag
   visibility? Decide the recipient set; the mechanism is unaffected.
4. **Flag = feed or worklist?** v1 is a notification + an AT12 lens (no state). If
   the board wants to *track* "reviewed / acknowledged" per flag, add a light ack
   state (not a full approval model). Defer until asked.
5. **AT12 home.** A new scoped `facility/corrections` route/page (recommended) vs
   extending the sysadmin-gated `/system-status/audit-log` with a visit rollup.
6. **Exact self=actor proof in AT12.** Marker-only (`newData.type`) is the
   default. For an exact guarantee, add `secondaryAffectedEntity = subjectPersonId`
   to every visit-audit write (one line per path) so self = `actorId ===
   secondaryAffectedEntity` without a join. Recommend adding it.

---

## Security-boundary note

`Visit` fields are `@sensitivity:public`/`personal`; `AuditLog` is
`@sensitivity:internal`. The `facility/corrections` read exposes audit rows
(internal) — it must be a registered route with a tight select, and per the
boundary-isolation rule any registry/scope change ships in its own PR ahead of
the feature route. The `VisitSource` split is **not** a boundary change and
needs no isolated PR: `classifications.ts` tiers *fields*, not enum values —
`arrivedVia`/`departedVia` stay `public` whatever the value set is, so adding
values leaves the generated file byte-identical (verified), and
`security-boundary-isolation.yml` fires only on `src/security/**` (excluding
`generated/`), the generator script, or a genuine re-tier of an existing field.
It therefore ships inside the AT3 PR, as §3 says. The self-scoped
`PATCH`/`DELETE` writes only the actor's own (or a
household member's) `Visit` — no new sensitivity surface. The scope check
(`personId` = self or a household member, never from the body) is the security
invariant and belongs in the route, not the UI; the significance/flagging logic
is oversight, not an access boundary, so it never gates the write.
