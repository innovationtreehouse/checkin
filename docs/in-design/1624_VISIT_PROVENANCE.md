# Visit provenance: what `arrivedVia` means after #1675

**Issue:** [#1624](https://github.com/innovationtreehouse/checkin/issues/1624)
— umbrella for #1631 (merged), #1632 (open), #1675 (open).

**Status:** design. No board decision gates this — #1675 resolves the trends
filter, and what remains is a correction-restamp fix plus optional cleanup.

**Assumes #1675 lands first** (trends counts every completed visit regardless
of source). Everything below builds on that.

---

## 1. What #1675 resolves

#1675 deletes the `arrivedVia NOT IN (LEAD_MARKED, SYSTEM)` filter from
`facility/trends`. Every completed, non-deleted visit counts toward facility
hours. Source governs correction significance, not whether hours count.

That removes the constraint that made #1624 hard: #1631 stopped restamping
`arrivedVia` on corrections *because* restamping promoted LEAD_MARKED visits
past the trends filter. With no filter, there is nothing to promote past.

---

## 2. What remains

One bug. One cleanup.

### Bug: corrections don't restamp `arrivedVia`

After #1631, a member who corrects a SCANNER arrival twice still weighs the
second correction as overwriting a physical measurement (weight 3). The value
being overwritten is their own prior typed correction — weight should be 1.

This contradicts `docs/rules/attendance-checkin.md:155-157`:

> Correcting a time replaces where that time came from: a badge-measured
> arrival a member edits is their own report afterwards, not a measurement.
> Correcting the same time twice is weighed the second time as overwriting a
> self-report.

#1631's reason for not restamping was the trends filter. #1675 removes that
filter. Corrections should restamp `arrivedVia` to `WEB` again.

**Affected paths:**

| Path | Current | Fix |
|---|---|---|
| `attendance/manual/[id]` PATCH | arrivedVia unchanged | restamp `arrivedVia: "WEB"` when arrival changes |
| `facility/visits` PATCH | arrivedVia unchanged | restamp `arrivedVia: "WEB"` when arrival changes |
| `events/[id]` manualEditAttendance update | arrivedVia unchanged | restamp `arrivedVia: "WEB"` when arrival changes |

`departedVia` already restamps on those paths — arrivedVia is the gap.

### Cleanup: WEB → TYPED rename (optional)

`WEB` names a mechanism (a browser form). What the column records is a capture
method — was this time measured by hardware or entered by a person? `TYPED`
says that without implying self-service or a particular UI.

Not load-bearing. The weights, the writers, and the rules all work with `WEB`.
The rename just makes the name match the axis. File it separately if wanted;
it's an expand/contract enum migration against live data, so it carries its own
weight.

### Cleanup: LEAD_MARKED overloads (optional)

`LEAD_MARKED` means two things:
- A roster mark created a visit at the event window (both endpoints fabricated)
- Staff typed a departure on an existing visit (`events/[id]` update,
  `facility/visits` PATCH)

After #1675 this overload is cosmetic — nothing filters on the distinction.
Significance weights LEAD_MARKED at 2 in both cases, which is defensible: a
staff observation of when someone left is worth more than a self-report.

If the distinction ever matters, the audit trail already separates them:
`newData.type = "lead_attendance_correction"` vs `"staff_correction"`.

---

## 3. The fix

Restore `arrivedVia` restamping on correction paths once #1675 lands.

Three files, one change each: when the route updates `arrivedAt`, include
`arrivedVia: "WEB"` in the update. Mirror what those paths already do for
`departedVia` when they update `departedAt`.

Update the comment sweep #1675 does (which replaces the trends-filter rationale
with a significance rationale) — the comments already point the right
direction; they just need to not say "arrivedVia is left alone."

Update `attendance/manual/[id]/__tests__/route.test.ts` — the #1631 pin
("arrivedVia stays LEAD_MARKED through a correction") inverts to "arrivedVia
restamps to WEB on a correction."

Update `facilityTrendsAPI.integration.test.ts` — the self-corrected
LEAD_MARKED test that #1675 already rewrites; its `arrivedVia` assertion
changes from `LEAD_MARKED` to `WEB`.

---

## 4. Significance weights after the fix

With restamping restored:

| Source | Weight | When you see it |
|---|---|---|
| SCANNER | 3 | First correction of a badge-measured time |
| LEAD_MARKED | 2 | First correction of a staff-observed time |
| WEB | 1 | Any subsequent correction, or first correction of a self-report |
| FACILITY_CLOSE | 0 | Correcting a building-close placeholder |
| AUTO_CLOSE | 0 | Correcting a cron placeholder |
| SYSTEM | 2 | Legacy; same as LEAD_MARKED |

A corrected SCANNER arrival becomes WEB (1) — the next correction of that same
value weighs as overwriting a self-report, not a measurement. The attendance
rule holds.

The `byProxy` multiplier (×2 when actor ≠ subject) stays orthogonal. No
double-counting — actor is on the audit row, capture method is on the visit.

---

## 5. Ordering

1. **#1666** (#1632 backfill) — can land independently
2. **#1675** (delete trends filter) — lands after #1666
3. **This fix** (restore arrivedVia restamp) — lands after #1675
