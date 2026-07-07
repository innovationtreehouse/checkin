# My Programs — Roster & Info surface

**Status:** Implemented (this PR). Builds on the shipped MVP.
**Reference:** `docs/designs/MY_PROGRAMS_SCOPING.md` (repo root) — the scoping doc
that maps the existing capability. Read it first; this doc only covers the "Next"
slice it named (roster / attendance summary / stats), not the whole section.

## Problem

The shipped MVP gave program leads a home (`/my-programs`) with an attendance
*inbox* (work to confirm) and a conflicts tab. It stops there: a lead still can't
answer everyday operational questions in-app — *who is in my program, how do I
reach their family, who's actually been showing up, and how full am I?* The
scoping doc's "Next" section named exactly this: roster, attendance summary,
enrollment-vs-capacity, all read-only, all scoped to programs the caller leads.

This PR adds a **Roster** subtab delivering that, plus CSV export.

## Decisions (from the product interview — for programs the caller LEADS)

1. **Roster + contact info** — a participant list with status and the
   *household-lead* contact (email/phone): the "who do I call" view. Not the
   participant's own contact (often a child) — the parent/lead you'd actually
   phone.
2. **Attendance summary** — per-participant attendance count + last-seen across
   the program's events, and per-event turnout. Co-located with the roster
   (attendance-per-person is inherently a roster column) rather than bolted onto
   the attendance *inbox*, which stays a list of action items, not reference data.
3. **CSV export** — of the roster and of per-event turnout, from the same scoped
   route (`?format=csv`).
4. **Program stats card** — enrollment vs capacity, session count, and a
   scholarship-request **COUNT ONLY**. No names, no per-participant finance state
   (finance is board-confidential, permanently — scoping doc §5).

## Data model

No schema change. Everything reads existing tables:
- `Program.maxParticipants` → capacity; `Program.leadMentorId` → the scope key.
- `ProgramParticipant.status` (ACTIVE/PENDING) → enrolled/pending counts + roster row status.
- `ProgramParticipant.isPaymentPlanRequested` → aggregated into the scholarship
  **count** via a separate `count()`; never selected onto a roster row.
- `Person.isHouseholdLead` + `email`/`phone` (the "contact-identity band leads may
  hold", per its `@sensitivity` note) → household-lead contact.
- `Event` (per program) + `Visit.associatedEventId`/`arrivedAt` → attendance
  counts, last-seen, and per-event turnout (distinct-counted).

## Flows

- **Route:** `GET /api/my-programs/[id]` (one new route). Scoped: returns data
  only when the caller **leads** program `[id]` (`leadMentorId === caller`) or is
  board/sysadmin; otherwise 403 (404 for a missing program). Returns
  `{ program: {stats}, roster: [...], events: [...] }`, or a `text/csv`
  attachment (`filename="program-<id>-<kind>.csv"`) when `?format=csv&kind=roster|events`.
- **UI:** new `/my-programs/roster` subtab. Reuses the layout's existing lead-gate
  and `useTodoCounts().lead.programs` for the program list (a lead with several
  programs gets a selector). Renders the stats card, roster table (status +
  household-lead contact + attendance count/last-seen), a session-turnout table,
  and two CSV download buttons.
- **Pure math** lives in `src/lib/programRoster.ts` (visit → attendance
  aggregation, household-lead contact join, CSV serialization) so it's unit-tested
  without a DB.

## Prod-safety / PII discipline

- **Scoping is the security control**, not per-field stripping.
  `ProgramParticipant`/`Visit` rows are all public-tier, so their *existence* is
  the enrollment/attendance leak — only admission can hide it. The route
  query-shapes by `leadMentorId` (board/sysadmin pass through), matching the
  `programs/[id]` and `events/[id]` idiom. It is listed in
  `tests/security/routeAuthDrift.test.ts` `EDGE_INCLUDE_ALLOWLIST` with that
  justification (rule 3).
- **No boundary change.** The route uses `withAuth` + tight `select`s (like
  `nav/todo-counts`), not the registry/`handler` layer — so no `src/security/**`
  edit, no registry-first PR, and this ships as one self-contained diff.
- **Finance stays confidential.** `isPaymentPlanRequested` /
  `paymentPlanDeniedAt` / `inventoryHeldAt` / `pendingSince` are never selected
  onto a response row; scholarship demand is a bare count. Asserted by an
  integration test that greps the JSON/CSV for those field names.
- **Contact is not new PII.** `email`/`phone` are in the contact-identity band a
  lead may already hold (and leads already see this household's emergency contacts
  via `programs/[id]`). The interview authorized surfacing the household-lead's own
  email/phone as the operational "who to call".

## Deliberately deferred

- **Writes** — this is a read/export surface only. No enrollment decisions (board-
  only), no edits.
- **Assistant-lead role** — unchanged from scoping doc; not architected in here.
- **Comms with families** — the roster is the contact-list-first step the scoping
  doc names as the precursor; no messaging is built.
- **`_count`-only paging** — rosters are program-sized (tens), so the route
  returns full lists; add pagination only if a program ever gets large.
