# Badge Print Tracking

## Problem

Physical ID badges are printed for people who come to the facility, but nothing
records **that** a badge was printed or **when**. Ops has no way to answer "who
has / hasn't had a badge printed this year?" — so reprints, new-member badges,
and the yearly refresh are tracked by memory and spreadsheets. The
`/facility-ops/print-badges` page can generate a badge PDF, but generating a PDF
is not the same as a badge physically existing in someone's hand.

We want a durable, queryable record of badge prints and a report that surfaces
the gap (active people this year with no printed badge).

## Decisions (from the product interview)

- **Mark-printed + report, not a print/render flow.** Ops explicitly marks a
  badge printed; we do **not** auto-record a print when someone generates a badge
  PDF on the Print ID Badges page. Recording is a deliberate human act ("I
  printed and handed out this badge"), decoupled from PDF generation. *Rejected:*
  auto-recording on PDF generation — it conflates "made a file" with "a badge
  exists", and double-counts every preview/reprint.
- **Not derived from badge scans.** A `RawBadgeLog` scan means a badge was *used*,
  which implies one was printed *at some point*, but says nothing about **when**
  it was printed or by whom, and can't represent "printed but never scanned yet"
  (a brand-new member). *Rejected:* inferring print status from scan activity.
- **Multiple prints per person over time are normal** — reprints (lost/damaged
  badge) and the yearly refresh each produce a new `BadgePrint` row. There is no
  uniqueness constraint; the report de-duplicates to one row per person (most
  recent print + a count).
- **Report by calendar year (v1).** A year picker drives two lists: who was
  printed that year (with dates + who recorded it) and the gap list (active people
  that year with no print). *Deferred:* membership-year boundaries — see below.
- **Board/sysadmin gated**, exactly like the sibling facility-badge surfaces
  (`/facility-ops/badges`, `/facility-ops/print-badges`, `/facility-ops/trends`).

## Data model

New `BadgePrint` model (sibling of `RawBadgeLog` — both are physical-badge
lifecycle records):

| field         | type       | sensitivity | notes                                  |
|---------------|------------|-------------|----------------------------------------|
| `id`          | Int PK     | internal    | matches `RawBadgeLog.id`               |
| `personId`    | Int FK     | public      | badge subject (person linkage)         |
| `printedAt`   | DateTime   | internal    | defaults to now(); ops metadata        |
| `printedById` | Int FK     | internal    | actor (the ops person who recorded it) |
| `note`        | String?    | internal    | optional ("reprint — lost badge")      |

Indexes: `[personId, printedAt]` (a person's print history) and `[printedAt]`
(the year-window report scan). Additive, nullable-friendly, new-table-only —
migration `20260709020000_badge_print_tracking`.

`BadgePrint` is **not** registered as an edge-sensitive model
(`ProgramParticipant`/`Volunteer`/`RSVP`/`Visit`). Those leak "who is
enrolled/present" by row existence; a badge-print record is ops metadata behind a
sysadmin/board gate, not a membership edge. The routes hand-shape a tight select
and return via `NextResponse.json`, same as `facility/badges` and
`facility/trends`.

## Flows

### Mark printed (single + bulk) — `POST /api/facility/badge-prints`

Body `{ personIds: number[], note?: string }`. Creates one `BadgePrint` per id
with `printedById = caller`, `printedAt = now()`. A single-person mark is just a
one-element array; the bulk path is the same call with many ids. No dedup — a
second call for the same person is a legitimate reprint and creates a second row.
Guards: non-empty integer array, max 500 ids/call, note trimmed to 500 chars, FK
violation → 400.

The UI surface is a new **Badge Prints** tab in Facility Ops (next to Print ID
Badges — you print, then record). The gap list has row checkboxes and a "Mark
selected printed" button, which covers both single (select one) and bulk (select
many) from one control — the same checkbox idiom the Print ID Badges page uses.

*Placement rationale:* Facility Ops, not Membership Ops. Badge printing is a
physical-facility concern and a direct sibling of the existing Raw Badge Events
and Print ID Badges tabs (same `isSysadmin|isBoardMember` gate). Membership Ops is
about the membership lifecycle (applications, households, reviews) — a badge
print is not a membership state change.

### Report — `GET /api/facility/badge-prints?year=YYYY`

Returns `{ year, printed[], gaps[] }`:

- **printed**: `BadgePrint` rows in the year window, grouped by person → one entry
  per person with `lastPrintedAt`, the recorder's name, and a `count` (so a
  reprinted person shows once, count 2).
- **gaps**: people in the "needs a badge this year" population who have **no**
  print in the year window.

**"Needs a badge this year" population.** Defined as *people with at least one
`Visit` in the year* — i.e. anyone who physically checked in during year X. This
is a defensible, existing-data definition: if you came to the facility this year
you should have a badge, and if you never came you don't need one printed. It
reads `Visit` only as a `where` filter (`visits: { some: { arrivedAt } }`), so no
`Visit` rows are returned and the route auth drift-guard's edge rule does not
apply (a where-only edge relation returns no rows). *Considered and not chosen:*
"active members" (org-membership status lives on `Household`, and members who
never show up don't need a printed badge) and `RawBadgeLog` activity (the raw scan
feed; `Visit` is the higher-level "was here" signal derived from it).

### Year window

`calendarYearWindow(year)` returns `[Jan 1 YYYY 00:00 UTC, Jan 1 YYYY+1 00:00
UTC)` — a half-open UTC interval, used for both the print scan and the visit
population filter. Pure and unit-tested.

*v1 simplification (documented ceiling):* the boundary is UTC, while the org runs
in US Central (`APP_TIMEZONE`). A badge printed in the last few evening hours of
Dec 31 Central lands in the next UTC year. At year granularity for an internal
ops report this is acceptable. **Membership-year alternative:** the richer version
keys the window to the membership year (e.g. renewal anniversary or a
board-configured Sept–Aug program year) instead of the calendar year, and/or
computes the boundary in `APP_TIMEZONE`. Deferred until ops asks for it.

## Prod safety

- Additive migration: one new table, two FKs, two indexes. No column changes, no
  backfill, no data loss — safe under expand-contract.
- All access behind `withAuth({ roles: ['isSysadmin','isBoardMember'] })`; 401/403
  covered by integration tests.
- Best-effort/external calls: none.

## Deliberately deferred

- Membership-year / timezone-aware boundaries (see Year window above).
- Editing/deleting a `BadgePrint` row (mistakes are corrected by a compensating
  note-bearing reprint entry, or a follow-up; the table is append-only for now).
- Registering the report route through the security handler/registry — the
  role-gated `NextResponse.json` shape matches the neighboring facility routes;
  no per-field tiering surface is exposed to non-admins.
- Per-person print history UI (the data model supports it via the
  `[personId, printedAt]` index; no screen for it yet).
