# Attendance correction review

Issue: [#1258](https://github.com/innovationtreehouse/checkin/issues/1258) (backlog AT12)

Governing design: `checkin-app/docs/designs/1256_ATTENDANCE_CORRECTION_SURFACE.md` §4.
This is a proposal; nothing here is built. §1 and §2 disprove three of its §4
claims, and §7 puts correcting them in the implementation PR's scope.

---

## Problem

Members can now correct their own attendance records, and staff can correct
anyone's. That was the point: a badge reader misses a departure, the nightly
sweep stamps a placeholder time, somebody was marked present who was not, and
the person affected should be able to fix it without filing a request.

Nobody can see those corrections in one place. When a change looks large enough
to matter, the system emails the board; that email is the entire oversight
surface. There is no page to open, so the board cannot answer the questions it
actually has: how many records changed last month, whether the same person keeps
changing theirs, whether an adult is editing someone else's record, or whether a
large correction was reasonable.

The one existing view of this data is a system-administrator forensic log that
lists every changed record in the system, of every kind, newest first. Finding
attendance corrections in it means paging past membership changes, payment
changes and role changes. The board does not have access to it, and would not
want to use it if it did.

## Objective

The board opens one page and sees attendance corrections: how many, of what
kind, by whom, to whose record, over time, with the ones the system judged
significant on top and the before-and-after of any single change one click away.

## Executive summary

**Board and system administrators** get a new Facility Ops tab, "Corrections".
It defaults to the significant changes; the full correction feed sits behind a
filter. Each row names who acted, whose record it was, what kind of change it
was, and what the times were before and after.

**Members, program leads and household leads** see no change. This is a read
surface; it grants nobody a new write.

**Operations** sees nothing yet. Widening the Facility Ops gate is a separate,
undecided question (#1476); this proposal ships on the gate the section already
enforces and widens with everything else when that lands.

**Nothing new is stored.** The screen reads the existing audit trail. There is
no correction record, no review queue, no approved/rejected state.

**Cost:** two PRs — a registry entry, alone, first; then the route and the page.

**Gated on #1523.** Two requirements sit on the audit writers. #1478 satisfied
the first — every visit audit write now stores the subject person. The second,
persisting significance on every edit and delete path, is tracked as #1523 and is
what this design still waits on. §7 states both and why neither can be worked
around at read time.

**Deliberately not included:** an acknowledged/reviewed state per correction, an
undo button, and any calibration control for the significance thresholds. §5
says why for each.

---

## 1. The substrate: what the audit trail actually records

The screen has three axes: kind, actor class, and time. Kind and time come off
the audit row directly. Actor class does not.

`AuditLog` carries `actorId`, `action`, `tableName`, `affectedEntityId`,
`secondaryAffectedEntity`, `oldData` and `newData` (`checkin-app/prisma/schema.prisma`).
Every field is `@sensitivity:internal`. Both id columns are bare `Int` with no
foreign key and no discriminator; nothing in the schema says what
`secondaryAffectedEntity` points at, and nothing stops two meanings sharing it.

**The actor axis is sound on `main` today.** An earlier draft of this section
catalogued five writers that stored a non-person id in `secondaryAffectedEntity`;
#1478 closed the last three, and all twelve visit audit writes now store the
subject. That history is not repeated here — §2 states the invariant the screen
depends on, and §7 records that it is met.

What survives is narrower, and §3 rests on it. Two shapes of audit row carry no
diffable content, and no fix changes that because there is nothing to record:

| Writer | Why there is nothing to diff |
|---|---|
| `events/[id]/attendance/route.ts` — roster mark (CREATE and EDIT) | Stores no times at all. A create has no earlier value, and the edit sets `associatedEventId` without moving a clock. |
| `facility/visits/route.ts` — EDIT, rows written before #1478 | Stored no `oldData`. #1478 added it, so only the pre-fix tail is affected. |

**Significance therefore cannot be recomputed uniformly**, which is the whole of
§3's argument. `editSignificance` needs the old times and the old
`arrivedVia`/`departedVia` to weight them
(`checkin-app/src/lib/visit/significance.ts`); neither shape above supplies them.

**The participant merge is a documentation error in the governing design, not a
gap in the data.** Its audit-coverage inventory lists the merge as a `Visit`
audit writer. It is not one: the merge re-parents visits with
`tx.visit.updateMany` and logs `tableName: "OrgMembershipProcess"` and
`tableName: "Person"` only. That behaviour is right and should stay — a merge
moves rows between two records of the same human and changes no attendance fact,
so auditing it as a correction would fill the feed with non-corrections. One
consequence does survive into this screen: a subject id on an older row may
belong to a person since merged away. Merges delete nothing and
`Person.mergedIntoId` records the survivor, so the drill-down resolves the name
and can follow the pointer.

## 2. The actor axis, and what it requires of the writers

**This screen requires one invariant: every visit audit write stores the subject
person in `secondaryAffectedEntity`.** #1478 (AT3) declared that rule and closed
the writers that broke it; all twelve now satisfy it on `main`. This design does
not restate how that was found — it depends on the invariant holding, and §7
records it as met.

The design decision worth recording is what this screen must *not* do about it.

**Do not special-case the exceptions at read time.** That means encoding "this
column means a person, except on these paths, where it means an event, except
when it is null" into a filter, which must then be kept in step with every future
writer. The column would carry two meanings permanently, and the next person to
add a visit audit write has no way to know which convention applies. A screen is
the wrong place to hold an invariant about a write, and a read-side workaround
for rows written before the fix can never be retired — a reader cannot tell which
convention an old row followed, because nothing on the row records it.

That is why the invariant has to hold at the writers before this screen is built,
rather than being absorbed into it.

**Given the invariant, the actor axis is a comparison, no join:**

- `actorId === secondaryAffectedEntity` → **self**
- `actorId !== secondaryAffectedEntity` → **proxy**, meaning one person changed
  another person's record: a household lead, a program lead, ops, board or
  sysadmin

The screen splits proxy no further, and #1502 is the reason to say why
explicitly rather than by omission. That PR gives the boundary layer a formal
name for one kind of proxy — `led_households`, a household lead acting for a
member of the household they lead. It is tempting to reuse it here. It does not
work: `led_households` is resolved for the *viewer* at request time from the
caller's current household leadership, never recorded on the audit row. It
cannot say what relationship held when the edit happened, which is the only
question this screen asks. Reconstructing that needs role state as of the edit,
which nothing stores.

The board's question is "did somebody else change this person's record", and the
two-way split answers it. `newData.type` stays useful as a label on the
drill-down (`manual_entry`, `self_correction`, `staff_entry`,
`lead_attendance_correction`), where it accurately names the route; it is not
the axis.

## 3. Flagged: read, not recomputed, and made complete at the write

Governing design §4 says the significance function runs at read time. §1 shows
it cannot: rows 4 and 5 carry no times to diff.

Recomputing has a second problem that matters more. A recomputed flag lives in
JavaScript, so the database cannot filter on it, which means the default view of
this screen cannot be paginated: every audit row in the range has to be loaded
and scored before the first page can be cut. The persisted flag is a JSON path
predicate Prisma can put in the `WHERE`.

Reading has its own cost, and it is real: a persisted score freezes the
thresholds in force when the row was written, and `significance.ts` says in its
own header that those thresholds are v1 defaults awaiting board calibration.

**Recommendation: a hybrid, with the split on the surface rather than on the row.**

1. **The list reads the persisted value.** `newData.significance.flagged`,
   filtered in the database, paginated normally.
2. **The drill-down recomputes.** One row is already loaded and it has
   `oldData`; scoring it again against today's thresholds is free. When the two
   disagree, the detail view shows both and says the row was scored under
   earlier thresholds. That is the honest presentation, and it is also what
   makes recalibration observable: the board changes a threshold and can see, on
   any historical row, what the change would have done.
3. **Every write path that edits or deletes a visit persists significance.**
   A requirement on the writers, tracked as #1523 rather than restated here.
   §7 gates on it.

Point 3 is the one that needs arguing, because the cheap option is to leave the
flagged lens covering member self-corrections only and let staff corrections
show up in the unflagged feed. Reject that: a lens with a hole it does not
declare is worse than no lens. A board member reading "no flagged corrections
this month" would reasonably conclude no significant corrections happened, when
what actually happened is that the paths capable of the largest corrections are
the ones that never score themselves. The significance model in §2 of the
governing design weights *the value being overwritten*, not the person
overwriting it; moving a scanner-measured arrival two hours is equally notable
whoever does it.

The screen cannot compensate for this at read time. A row that never scored
carries no `oldData` in some cases and no times at all in others (§1), so there
is nothing to recompute from — the gap is only closable at the write.

**Rows that carry no significance are not "unflagged", they are outside the
lens.** A create has no earlier value to overwrite, and the significance model
defines nothing for it; the events-attendance edit changes only which event a
visit belongs to and moves no time, so its delta is zero by construction. Both
appear in the feed under their own kind. Neither is ever shown as "reviewed and
found insignificant", because nothing reviewed it.

**Whether the roster-mark create ever needs a score at all is open; see §6,
question 1.**

## 4. The read surface

### Route

`GET /api/facility/corrections`. It does not exist on `main`.

**Gate: `{ anyRole: ['isSysadmin', 'isBoardMember'] }`.**

Governing design §4 says sysadmin, board and ops. Ops cannot have this page
today: `checkin-app/src/app/facility-ops/layout.tsx:10` gates the whole section
on `useRequireRole(["isSysadmin", "isBoardMember"])`, and every tab in
`checkin-app/src/lib/facilityNav.ts` sits under it. Granting ops the route while
the layout keeps them out of the section produces a role that can call the API
and cannot reach a page, which is the defect (AT13) this design family exists to
close. #1476 is the open decision about widening that gate; when it lands, the
layout, this route, its page and the sibling visit routes widen together in one
change. This proposal does not pre-empt it.

### Registry first, in its own PR

`AuditLog` is `@sensitivity:internal` in every field, so this route is a
boundary change and its `defineRoute` entry ships **alone, ahead of the
handler**. That is the repo's rule (`checkin-app/src/security/registry.ts`
header; enforced by `.github/workflows/security-boundary-isolation.yml`) and it
has a recent precedent: #1492 registered `POST /api/facility/visits/insert` as a
registry-only PR with the handler following in #1478.

Note for whoever reviews that PR: **no registered route returns `AuditLog`
today.** `GET /api/system-status/audit-log` predates the registry and is
grandfathered in `checkin-app/scripts/legacy-authz-routes.txt`. This is the
first, so the entry deserves more than a glance.

```ts
defineRoute({
    endpoint: 'GET /api/facility/corrections',
    authorize: { anyRole: ['isSysadmin', 'isBoardMember'] },
    envelope: null,
    // Bag: rows derived from AuditLog, with actor/subject names resolved
    // through Person (id and name are both public tier).
    returns: ['AuditLog', 'Person', 'Visit'],
    orderedView: [
        ['isSysadmin',    ['everyones:personal', 'everyones:internal', 'public']],
        ['isBoardMember', ['everyones:personal', 'everyones:internal', 'public']],
    ],
});
```

The registry header is explicit that the stripper is a backstop and not the
first line of defence; handlers still owe a tight select. That applies with
force here, because the handler reshapes JSON into fields the stripper cannot
map back to a model.

### Response shape — decided here, because the registry entry cannot wait

An earlier draft of this section specified a derived body — `{ buckets, rows,
total, page, pageSize }` with fields like `kind`, `actorClass`, `flagged`,
`before`, `after`. **That cannot pass the boundary.** The shape is therefore
settled in this section rather than deferred: the registry entry lands alone and
inert *ahead* of the handler, so getting it wrong means a merged boundary PR
describing a response that cannot exist.

Two mechanisms make it impossible, both verified on `main` at `8a420411`:

- `stripBag` (`checkin-app/src/security/stripper.ts:29-32`) iterates the bag's
  top-level keys and **drops any key that is not a model name**, with a console
  warning. `buckets`, `rows`, `total`, `page` and `pageSize` are not models.
- `stripValue` (`stripper.ts:63-64`) copies only fields present in
  `classifications[model]`. `kind`, `actorClass`, `actorName`, `subjectName`,
  `flagged`, `score`, `before` and `after` are derived names, not `AuditLog`
  columns, so each is dropped.

Under the entry printed above, that route returns `{}`. There is no escape
hatch: `handler()` always strips (`handler.ts` step 6), all 76 entries in
`classifications` are real Prisma models, and `_count` is special-cased only for
*relation* counts — not arbitrary groupings. And a new route cannot simply stay
on `withAuth`, because `check-route-coverage.ts`'s `new-route-old-authz` rule
blocks an unregistered new route even in advisory mode.

**None of the 19 registered routes returns an aggregate**, so there is no
precedent to copy. This design is the first, which is why the question is
answered here rather than in the route PR.

**Why the grant above reads `everyones:personal`.** `Visit.arrivedAt` and
`departedAt` are **`personal`** (`classifications.ts:281-282`); everything else
the screen needs from `Visit` is `public`. A view granting only
`everyones:internal` and `public` returns the ids and the `arrivedVia`/
`departedVia` provenance and **strips both timestamps** — the before/after column
renders empty. `POST /api/facility/visits/insert` already grants
`everyones:personal` to the same two roles. `pii` is deliberately not granted:
only `Person.name` is needed, which is `public`, so email cannot ship. `member`
is not granted because no field on `AuditLog`, `Person` or `Visit` carries that
tier.

**The four options, with their real costs:**

1. **Ship model rows, derive on the client.** Bag is `{ AuditLog, Person, Visit }`.
   Passes the boundary today with no new machinery, and the cost is worse than
   the tight-select concession it first looks like. `oldData` and `newData` are
   `internal` JSON blobs that **contain `personal` Visit times**. Field tiers do
   not reach inside JSON, so shipping the blobs whole under an
   `everyones:internal` grant delivers `personal` data to a view that was never
   granted `personal`. That is routing around the classification, not relaxing a
   principle. It also breaks §3's pagination argument, because bucket counts
   computed from one page describe only that page.
2. **Two requests.** Paginated rows as in (1), plus a separate counts endpoint.
   Does not help: a count is still not a model field, so the second response
   faces the identical problem.
3. **Extend the boundary** to declare derived or projected views. The right
   long-term answer and not this design's to make — PR #1518's per-caller-view
   `select` proposes exactly this mechanism. It is not available now.
4. **Synthesize the bag.** `stripValue` copies any field *present on the object*
   (`stripper.ts:64` — `if (!(field in obj)) continue`) and never checks where
   the value came from. So the handler can build bag entries rather than passing
   rows through: `{ AuditLog: rows with the blobs deleted, Person: [...],
   Visit: [...] }`, where each `Visit` entry carries `arrivedAt`, `departedAt`,
   `arrivedVia` and `departedVia` **extracted from the blobs**. Those are real
   `Visit` field names, so they classify as `Visit` data and are governed by the
   honest `everyones:personal` grant. The raw blobs never leave the handler.

**Recommendation: (4).** It needs nothing from #1518, and unlike (1) it does not
route `personal` data through an `internal` grant — the times are delivered as
what they are, under a grant that says so.

**Its honest limits, so the route PR does not discover them.** `after` is a real
`Visit` row fetchable by id; `before` exists only inside `oldData`, and one bag
cannot hold two `Visit` arrays keyed to the same id — so `before` needs either a
separate bag key or a documented convention, and that is the one piece the route
PR still has to design. Derived scalars remain homeless: `kind` and `actorClass`
fall out client-side from `action`, `actorId` and `secondaryAffectedEntity`,
which do ship, but `flagged` and `score` live in `newData`.

So (4) **halves the exposure rather than eliminating it**: ship `newData` — the
small blob, one significance object — and keep `oldData`, the whole-row
snapshot, server-side. That trade should be stated in the route PR rather than
inherited silently.

Whatever is chosen, `returns` must include **`Visit`**: `before`/`after` carry
`arrivedAt`, `departedAt`, `arrivedVia` and `departedVia`, which are `Visit`
fields, and the entry above omits it.

Query parameters: `from`, `to`, `period`, `kind`, `actorClass`, `flagged`,
`page`. Base filter `tableName: 'Visit'`, pinned in the handler and never taken
from the request.

**`period` cannot offer `day`.** `PeriodType` is `"week" | "month" | "quarter" |
"year"` (`facility/trends/route.ts:9`) and `getPeriodStart`'s final `else`
buckets to **year**, so an unrecognised value silently yields year buckets
rather than an error. Either accept the four values that exist, or widen the
extracted helper and say so in the PR that extracts it. This design takes the
four that exist.

**Bucketing reuses `getPeriodStart` from
`checkin-app/src/app/api/facility/trends/route.ts:19`.** #1423 merged and that
function now takes an explicit `timeZone` and buckets in the organisation's
zone. It is the one correct implementation in the repo; extract it to a shared
module rather than adding a third.

### Page

`/facility-ops/corrections`, a fifth entry in
`checkin-app/src/lib/facilityNav.ts`, and a matching row in
`checkin-app/src/components/pageRegistry.ts` with the `BOARD` predicate, which
already means sysadmin-or-board and already backs the four existing Facility Ops
entries. When #1476 widens the gate, `BOARD` becomes `BOARD_OR_OPS`.

## 5. Out of scope

Named so the implementation PR does not grow into them:

- **A second generic audit browser.** `tableName` is pinned to `Visit` in the
  handler. Filtering by table is what `/system-status/audit-log` is for.
- **Acknowledged/reviewed state.** Settled on #1258 and in governing design
  §6.4: a feed, no state, until the board asks for a worklist.
- **Undo.** A tombstoned visit is restorable by clearing `deletedAt`, and a
  restore button is an obvious next ask. It is a write, on a read screen, and it
  belongs to whoever specifies what an undo means for an edit that the checkout
  split into several rows.
- **Threshold calibration UI.** `significance.ts` says to promote the weights
  and threshold to `BoardSettings` "when the AT12 screen gives the board a place
  to calibrate from". This screen is that place, and the promotion is still a
  separate change. See §6, question 2.
- **Changing who receives the write-time flag email.** Governing design §6.3; a
  write-side decision this screen does not touch.
- **Widening the Facility Ops gate to ops.** #1476. §4.
- **Auditing visit re-parenting in the participant merge.** §1.
- **The unaudited paths.** The kiosk scan, the facility close and the nightly
  sweep write no audit row and should not start; they are not corrections. The
  provenance of a machine close lives in `departedVia`, which is where the
  significance rule reads it.

## 6. Open questions

Both are judgement calls that code cannot settle. Everything else that was open
on #1258 is answered above: the actor axis in §2, the significance persistence
and the read-versus-recompute split in §3, the gate and the trends bucketing in
§4, and the participant merge in §1.

1. **Does a roster mark need a significance score, or is "an insert exists" the
   whole signal?** A program lead marking somebody present creates a visit from
   nothing; there is no overwritten value to weight, so the current model scores
   it zero and it never flags. Fabricating a score for it — weight by the length
   of the event window, say — is possible, and might matter if the concern is a
   lead inflating a roster; it is also inventing a number the model does not
   define. Recommendation: leave it unscored in v1 and let the insert count
   carry it, which is what the feed already shows.

2. **Does v1 ship the threshold calibration control, or read-only first?**
   Recommendation: read-only. The thresholds are guesses until there is real
   volume, and the board cannot calibrate sensibly before seeing a few months of
   this screen. Promoting them to `BoardSettings` is a small change to make once
   somebody has an opinion about what the number should be.

## 7. What this design is gated on

This screen is not implementable until the substrate it reads is correct. Two
requirements sit on the writers. Neither is restated here; both are tracked where
they are actionable.

1. **`secondaryAffectedEntity` holds the subject person on every visit audit
   write.** §2's actor axis is a direct comparison against this column; without
   the invariant the axis returns a wrong answer silently rather than failing.
   **Satisfied.** #1478 closed the three remaining writers, and all twelve visit
   audit writes on `main` now store the subject.
2. **Every edit and delete path persists `newData.significance`.** §3's flagged
   view reads this column, and a row that never scored cannot be scored
   retroactively — some of those rows carry no `oldData`, and some carry no times
   at all, so there is nothing to recompute from. **Open: #1523.** One file of
   seven scores today.

Requirement 2 outlived its host. It was raised on #1478 as non-blocking, #1478
merged with the other two items fixed, and it is now its own change rather than
four lines inside an existing one — the cost §2 predicts for deferring this class
of fix.

**Sequence:** #1523 lands → this design merges → the `defineRoute` entry ships
alone (§4) → the route and the page.

§4's response shape is **not** a gate on this document — it is decided in §4,
which is the only place it can be decided, because the registry entry ships
before any handler exists to discover the problem. An earlier draft listed it as
a precondition, which made the doc gate its own merge on a question it is the
place to answer.

#1523 is the only gate. Merging before it lands would leave a design whose
flagged view reads a column most writers do not fill, and would invite an
implementation that quietly works around the gap at read time — which §2 argues
is the one thing this screen must not do.

### What must outlive this document

This file is deleted at merge (`DOCUMENTATION_STANDARD.md` §4 — *extract, then
delete*). Two things must be extracted first, or they die with it.

**1. Extract the invariant to `docs/rules/attendance-checkin.md`:**

> Every write that audits a `Visit` stores the subject person in
> `secondaryAffectedEntity` — the person whose attendance changed, never the
> event, never the actor when they differ.

It passes the register's own bar cleanly: a change could violate it, and the
change is obvious. It currently lives in three code comments and merged design
prose, and `docs/rules/attendance-checkin.md` does not mention it at all —
verified on `main`. §7 calling it "Satisfied" is exactly the phrasing that stops
someone extracting it, because a satisfied requirement reads as finished rather
than as a rule to keep. This screen's actor axis is a bare integer comparison
against that column; a future writer who breaks it makes the screen answer
wrongly and silently.

**2. Correct three claims in `1256_ATTENDANCE_CORRECTION_SURFACE.md` §4.** They
are disproved here and nowhere else, and this document's deletion takes the
corrections with it. **Add the §4 edit to the implementation PR's scope:**

- line 559 — `newData.type` as the self-versus-staff discriminator. It names the
  route, not the relationship; #1478 writes `type: "self_correction"` for a
  household lead acting on someone else.
- line 564 — significance recomputed at read time. §1 shows two row shapes carry
  nothing to recompute from.
- line 575 — the gate as `sysadmin + board + ops`. Ops cannot reach the section
  (§4); the entry ships at the two roles the layout enforces.

---

## Appendix: provenance

- Backlog AT12, issue #1258. Readiness was moved to NOT READY on 2026-07-26 with
  six clarifying questions; this proposal answers five and narrows the sixth.
- Governing design: `checkin-app/docs/designs/1256_ATTENDANCE_CORRECTION_SURFACE.md`,
  §4 (this screen) and §6.6 (the subject-id convention). Its claims about the
  participant merge, the self-versus-staff test and read-time recomputation are
  corrected in §1 and §2 above.
- **Gated on #1523**, open — significance persistence, the one writer requirement
  still outstanding. §7.
- **#1478 (AT3)** merged, satisfying the subject-person invariant this design's
  actor axis rests on. §2.
- Blocked from widening by #1476 (ops gate), an open decision. §4.
- Unblocked by #1423 (org-timezone bucketing), merged. §4.
- Registry-first precedent: #1502 (visit scopes, boundary-only) alongside its
  app-only sibling #1478, and #1492 before #1478. Earlier: #1395, then #1357.
- Sequence in §7.
- Code claims verified against `origin/main` at `8a420411`. #1478 is merged;
  the commits that satisfied requirement 1 are on `main` at `d4b38c5b`.
