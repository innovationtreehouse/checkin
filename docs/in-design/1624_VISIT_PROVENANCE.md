# Visit provenance: splitting the axes on `arrivedVia`

**Issue:** [#1624](https://github.com/innovationtreehouse/checkin/issues/1624)
— umbrella for #1631 (merged), #1632 (open).

**Status:** design — a board decision gates the work (§4).

---

## 1. The problem

`arrivedVia` / `departedVia` (`VisitSource`) carries three facts in one column:

| Axis | What it answers | Where it belongs |
|---|---|---|
| **Existence** | Is there an attestation that this visit happened at all? | Row-level — a property of the visit, not of either endpoint |
| **Time capture** | How was this endpoint measured, typed, or stamped? | Per-field — each of arrivedVia/departedVia independently |
| **Actor** | Self or proxy? | Already on the audit row: `actorId` vs `secondaryAffectedEntity` |

The actor axis is already separated (design doc §6.6 is explicit). The first
two are fused into `arrivedVia`, and neither consumer can read its axis without
misreading the other.

---

## 2. Current consumer readings

### Trends — reads existence, gets time-capture

`facility/trends/route.ts:79-81` excludes `LEAD_MARKED` and `SYSTEM`:

```
OR: [
    { arrivedVia: null },
    { arrivedVia: { notIn: ["LEAD_MARKED", "SYSTEM"] } },
],
```

The comment says "those times are an event window, not a measured duration" — a
statement about **time capture** (precision). But what the filter *does* is
exclude visits whose existence is only staff-asserted — an **existence** filter
wearing time-capture language. The difference matters because:

- A staff-corrected SCANNER visit is precise and well-measured, but the
  correction is staff-typed. Time-capture says "staff typed" → exclude.
  Existence says "there was a badge" → keep. The filter keeps it (arrivedVia is
  still SCANNER), which is the right answer for the wrong reason.
- A member typing their own hours via `attendance/manual` stamps `WEB`. The
  visit exists because the member says so — a real attestation — but the time is
  self-reported, not measured. The filter keeps it (WEB ∉ exclusion list),
  which is right under existence but debatable under time-capture.

### Significance — reads time-capture, can't reach it after #1631

`lib/visit/significance.ts:16-31` weights by source:

```
SCANNER: 3    // physical measurement
LEAD_MARKED: 2 // staff observation
WEB: 1        // the member's own prior self-report
```

This is a time-capture reading: how authoritative was the method that produced
this value? The WEIGHTS comment on WEB says "the member's own prior
self-report" — a claim about *who* (actor) hung on a value named for *where*
(mechanism).

After #1631, corrections no longer restamp `arrivedVia`. A member who corrects
their own SCANNER arrival still weighs as SCANNER (3) on the second correction,
even though the value being overwritten is now their own prior self-report. This
contradicts the attendance rule
(`docs/rules/attendance-checkin.md:155-157`):

> Correcting a time replaces where that time came from: a badge-measured
> arrival a member edits is their own report afterwards, not a measurement.
> Correcting the same time twice is weighed the second time as overwriting a
> self-report.

#1631 was correct to stop restamping — restamping promoted LEAD_MARKED visits
past the trends filter — but it left significance reading stale provenance. One
column cannot serve both consumers.

### Writers — disagree because the value cannot express what they mean

| Writer | What it stamps | What it means |
|---|---|---|
| `scan` (kiosk) | SCANNER | Measured. Self. Both axes pin. |
| `attendance/manual` POST | WEB | Self-reported. But the route takes a `subjectId`, so a household lead backfilling for a child also stamps WEB — a proxy claim on a "self-report" value. |
| `attendance/manual/[id]` PATCH | *(unchanged)* | #1631: leaves arrivedVia alone. Correct for trends, stale for significance. |
| `events/[id]` manualEditAttendance — create | LEAD_MARKED | Staff-asserted existence + event-window time. Both axes pin. |
| `events/[id]` manualEditAttendance — adopt walk-in | *(unchanged)* | Keeps the walk-in's SCANNER/WEB arrival. Correct. |
| `events/[id]` manualEditAttendance — update | *(unchanged on arrival)*, LEAD_MARKED on departure | Arrival provenance is preserved; departure is staff-typed. |
| `facility/visits/insert` | LEAD_MARKED | Board typing a visit for someone who was never badged in. Changed from WEB on main; #1632 backfills the historical WEB rows. |
| `facility/visits` PATCH | *(unchanged on arrival)*, LEAD_MARKED on departure | Same as events/[id] update. |
| `facility/visits` DELETE | tombstone | Not a source question. |
| facility-close sweep | FACILITY_CLOSE on departure | Machine placeholder. |
| auto-close cron | AUTO_CLOSE on departure | Machine placeholder. |

`facility/visits/insert` stamping WEB on a board-typed visit was the plainest
defect — it made a staff assertion indistinguishable from a member's
self-report. The ongoing write now stamps LEAD_MARKED (landed on main); #1632
(PR #1666, open) backfills the historical rows. That fix is correct within the
current enum, but under this design both the old and new stamps are wrong: the
board is vouching for the visit's existence (ATTESTED), and the time is
staff-typed (TYPED) — neither LEAD_MARKED nor WEB expresses both.

---

## 3. The three axes, separated

### Axis 1 — Existence attestation (row-level)

Does somebody vouch that this visit happened?

| Value | Meaning |
|---|---|
| `ATTESTED` | A person — the member, a household lead, a program lead, or the board — asserts this visit occurred. |
| `UNATTESTED` | The visit row exists only because a machine process created or completed it (roster mark with nobody confirming, facility-close, auto-close). No human vouches for the span. |

This is a row property, not a per-field one. A correction to a SCANNER visit's
arrival time does not change whether the visit happened — the badge did. A
roster mark that staff later corrects to a precise time is still staff-asserted.

Where it matters: trends. The filter's real question is "should this visit
count toward facility hours?" — which is existence, not measurement method.

### Axis 2 — Time capture (per-field, arrivedVia/departedVia)

How was this endpoint's time produced?

| Value | Meaning |
|---|---|
| `SCANNER` | Physical badge at the kiosk — measured. |
| `TYPED` | A person entered a time in a form — self-reported or staff-entered. |
| `FACILITY_CLOSE` | Building-close sweep stamped it. |
| `AUTO_CLOSE` | Overnight cron stamped it. |

`WEB` → `TYPED`: what matters is the capture method, not the mechanism. A
kiosk badge and a web form are different mechanisms; a measured time and a typed
time are different capture methods. The rename makes the axis it names
unambiguous.

`LEAD_MARKED` disappears from this axis. A lead's roster mark is staff-asserted
existence (axis 1) plus event-window time (axis 2 = `TYPED`, since the window
is a typed fabrication, not a measurement). The value only existed to fuse both
axes.

Corrections DO restamp this axis. When a member corrects a SCANNER arrival,
`arrivedVia` becomes `TYPED` — the value is now their report, not the badge's.
Significance reads the weight it expects, and the attendance rule holds:
"correcting a time replaces where that time came from."

### Axis 3 — Actor

Self or proxy. Already derivable from `actorId` vs
`secondaryAffectedEntity` on the audit row. The significance function takes
`byProxy` as a parameter. No schema change needed.

---

## 4. The board decision

**What do facility hours measure?** Three possible readings, and the filter and
backfill differ for each:

### Option A — Attested existence

"Count every visit a person vouches for." The broadest filter — a member typing
their own hours counts, a board-entered walk-in counts, a roster mark
does not (nobody vouched for the specific span). This is what the current
filter approximates. The `facility/visits/insert` write is now LEAD_MARKED on
main, so those visits are excluded from trends — under this option they should
count, since the board vouched for the visit.

Trends filter: `WHERE attestation = 'ATTESTED'`

Backfill: existing `LEAD_MARKED` rows are a mix of roster windows (unattested)
and staff-typed corrections of real visits (attested). The correction rows need
to be identified — by audit trail — and set to `ATTESTED`; pure roster marks
stay `UNATTESTED`.

### Option B — Precise time

"Count visits whose times are not an event-window placeholder." A roster mark
stamped at the event window is excluded; a staff correction that types a precise
time for a real visit is included. The current filter's comment gestures at this
("not a measured duration") but the actual exclusion is cruder.

This is the same split as option A for prospective data, but the backfill
differs: it turns on whether the time is a placeholder, not on who typed it.

### Option C — Measured time

"Count only badge-measured arrivals." The narrowest filter — only SCANNER counts,
everything typed by a human is excluded. This drops self-reported hours from
trends entirely, which is a policy question about whether members' own claims
belong in the facility's hours count.

Trends filter: `WHERE arrivedVia = 'SCANNER'`

No backfill ambiguity: the SCANNER stamp is definitive.

### Recommendation

**Option A** (attested existence) is the closest to the current behavior and
the clearest concept. The filter's intent has always been "skip rows nobody
vouches for," even when its language was about measurement. The attendance rules
doc says "hours are counted from visits" and "there are no separately recorded
hours to correct" — the concept is that a visit is a real event, and its hours
are a derived read over its times. Existence is the fact that makes it a visit
rather than a placeholder.

Options B and C are defensible — B if the board wants precision over
completeness, C if they want only hardware-verified hours. The choice is theirs.

---

## 5. Schema change

### New column

```prisma
model Visit {
  // ...existing fields...
  attestation   Attestation?   // null = legacy, treated as ATTESTED
}

enum Attestation {
  ATTESTED
  UNATTESTED
}
```

Nullable so the expand phase is additive-only. Legacy rows with `null` are
treated as `ATTESTED` in queries — most existing rows are badge-ins or
self-reports that do have an attestation, so `null = ATTESTED` is the safe
default.

### Rename WEB → TYPED

`VisitSource` becomes:

```prisma
enum VisitSource {
  SCANNER
  TYPED        // was WEB — any human-entered time
  LEAD_MARKED  // kept during expand for old-code compatibility; dropped in contract
  FACILITY_CLOSE
  AUTO_CLOSE
  SYSTEM       // legacy, already scheduled for removal
}
```

### Migration path (expand/contract)

**Expand** (deploy first, old code still serves):

1. Add `Attestation` enum and `attestation` column (nullable).
2. Add `TYPED` to `VisitSource` enum.
3. Backfill:
   - Rows with `arrivedVia = SCANNER` or `WEB` → `attestation = ATTESTED`.
   - Rows with `arrivedVia = LEAD_MARKED` → examine audit trail; staff-typed
     corrections of real visits → `ATTESTED`, pure roster marks → `UNATTESTED`.
     (This is the ambiguous backfill; the board decision in §4 settles it.)
   - Rows with `arrivedVia = FACILITY_CLOSE` or `AUTO_CLOSE` → `UNATTESTED`.
   - Rows with `arrivedVia = SYSTEM` → same rule as `LEAD_MARKED`.
   - Rows with `arrivedVia = null` → `ATTESTED`.
4. Backfill `WEB` → `TYPED` on `arrivedVia` and `departedVia`.
5. Old code continues to write `WEB` and `LEAD_MARKED` — both are still valid
   enum values. New code reads both `WEB` and `TYPED` as equivalent.

**Contract** (after deploy, old code drained):

1. Update all writers to stamp `TYPED` instead of `WEB`, and to set
   `attestation` on create.
2. Update trends filter to `WHERE attestation = 'ATTESTED'` (or whichever
   option the board chose).
3. Update significance to restamp `arrivedVia = TYPED` on corrections, and drop
   the stale-provenance workaround from #1631.
4. Backfill any remaining `WEB` → `TYPED`, `LEAD_MARKED` that should be `TYPED`.
5. Remove `WEB`, `LEAD_MARKED`, `SYSTEM` from the enum.

### Corrections after the split

With separate axes, corrections work cleanly:

- **Trends** reads `attestation` (row-level) — a correction never changes it.
  A roster mark stays `UNATTESTED` even after time correction; a badge-in stays
  `ATTESTED` even after time correction. The #1631 problem does not exist.
- **Significance** reads `arrivedVia` / `departedVia` (per-field) — a
  correction restamps to `TYPED`, as the attendance rule requires. The weight
  drops from SCANNER(3) to TYPED(1) on the second correction.
- The rules-doc statement ("correcting a time replaces where that time came
  from") is restored: the per-field source changes, the row-level existence
  does not.

---

## 6. Consumers after the split

| Consumer | Reads | Before | After |
|---|---|---|---|
| `facility/trends` | existence | `arrivedVia NOT IN (LEAD_MARKED, SYSTEM)` | `attestation = ATTESTED` |
| `significance` | time-capture | `WEIGHTS[arrivedVia]` — stale after #1631 | `WEIGHTS[arrivedVia]` — restamped on correction |
| `my-programs/conflicts` | display | shows `arrivedVia` | shows `arrivedVia` (unchanged) |

---

## 7. Writer changes

| Writer | attestation | arrivedVia | departedVia |
|---|---|---|---|
| `scan` (kiosk) | ATTESTED | SCANNER | *(set on departure)* |
| `attendance/manual` POST | ATTESTED | TYPED | *(set on departure)* |
| `attendance/manual/[id]` PATCH | *(unchanged)* | TYPED *(restamped)* | TYPED *(if departure changed)* |
| `events/[id]` create (roster mark) | UNATTESTED | TYPED | TYPED |
| `events/[id]` adopt walk-in | *(unchanged)* | *(unchanged)* | TYPED *(if departure set)* |
| `events/[id]` update | *(unchanged)* | *(unchanged)* | TYPED *(if departure changed)* |
| `facility/visits/insert` | ATTESTED | TYPED | TYPED |
| `facility/visits` PATCH | *(unchanged)* | TYPED *(if arrival changed)* | TYPED *(if departure changed)* |
| facility-close sweep | *(unchanged)* | — | FACILITY_CLOSE |
| auto-close cron | *(unchanged)* | — | AUTO_CLOSE |

`facility/visits/insert` is ATTESTED: the board is vouching that this person
was here. The time is staff-typed (TYPED), not measured — but the existence is
attested.

---

## 8. What blocks

1. **Board decision (§4)** — what do facility hours measure? Until answered,
   the trends filter, the backfill, and the meaning of `UNATTESTED` are
   unsettled. This is the one decision this design cannot default.

2. **#1632 backfill** — currently open as PR #1666. The narrow backfill
   (staff-entry audit rows → LEAD_MARKED) is compatible with this design: those
   rows will be backfilled to `attestation = ATTESTED` + `arrivedVia = TYPED` in
   the expand phase regardless.

3. **`facility/visits/insert` already stamps LEAD_MARKED** on main. Correct
   within the current enum. After the split it becomes TYPED + ATTESTED.

---

## 9. Open questions

- Should roster marks whose times were later staff-corrected to precise values
  be promoted to `ATTESTED`? The board typed a real time, but the visit's
  existence is still only staff-asserted. If "attested" means "we know the
  person was here," a typed correction of a roster window does not add that
  knowledge — it just makes the placeholder less wrong.

- The `LEAD_MARKED` value on `departedVia` (set by `events/[id]` and
  `facility/visits` PATCH on staff-typed departures) conflates "staff typed
  this departure" with "this is a roster-mark departure." After the split, both
  become `TYPED` — the distinction between them lives on `attestation`, not on
  the departure source. Is anything lost?
