# Archiving / Un-archiving Programs

**Status:** Shipped on branch `feat/program-archive` (this PR).
**Product decisions:** 2026-07-08 (soft-archive semantics, board/sysadmin-gated).

## 1. Problem

The program-ops list, the public catalog, dashboards, and every program picker
show *every* `Program` row forever. Mistaken, cancelled, duplicated, or long-dead
programs accumulate and clutter those surfaces, and there is no way for the board
to retire one without deleting it (which would destroy the participant history the
ops surfaces still need to read). We want a reversible "put this away" action that
hides a program from the active surfaces and freezes new activity on it, without
touching its data.

## 2. Decision — a soft-archive flag, orthogonal to phase

`Program.archivedAt DateTime?` (`@sensitivity:internal`). NULL = live (every
existing row, unchanged); non-null = archived.

### Why a new field and not a `ProgramPhase` value

`phase` (`PLANNING → UPCOMING → RUNNING → FINISHED`) is a **lifecycle fact**: it
records where a program is in its natural run. `FINISHED` means "this program ran
and ended." Archiving is a **visibility/activity decision** the board makes — "stop
surfacing this and stop accepting new activity on it" — and it is **orthogonal to
phase**: a program in *any* phase can be archived (a mistaken `PLANNING` draft, an
`UPCOMING` program that got cancelled before it started, a `RUNNING` program pulled
early, a `FINISHED` program being tidied away). Folding archive into phase would
conflate "did it run?" with "should we show it?" and force lossy transitions (a
cancelled upcoming program is not `FINISHED`). A separate nullable timestamp keeps
both facts independently true and makes un-archiving a trivial `NULL` set that
restores the program to exactly its prior phase.

### Who / where

**Board and sysadmin only.** Archive and un-archive are surfaced on the
**program-ops program page** (`/program-ops/programs/[id]`) as an Archive /
Un-archive button, and ride the existing `PATCH /api/programs/[id]` via an
`archived` boolean gated to `isSysadmin || isBoardMember` (the same gate the
Shopify-identifier fields already use on that route — no new endpoint, no new
route-auth surface). Lead mentors cannot archive.

## 3. What archiving does

### 3a. Hidden from default lists / pickers / dashboards

A shared where-fragment `NOT_ARCHIVED = { archivedAt: null }`
(`src/lib/program/archive.ts`) is applied to the program-reading surfaces:

| Surface | Route / query | Behavior |
|---|---|---|
| Public catalog | `GET /api/programs` | archived hidden by default |
| Program-ops list | `GET /api/programs` (same route) | hidden by default; **"Include archived" toggle** re-includes them (`?includeArchived=true`, board/sysadmin-gated) |
| Session picker | `program-ops/sessions/new` → `GET /api/programs` | hidden (via the route) |
| Facility trends picker | `facility-ops/trends` → `GET /api/programs` | hidden (via the route) |
| Dashboard "active programs" count | `GET /api/nav/todo-counts` (`phase: RUNNING`) | archived excluded |
| Lead-surface todos | `GET /api/nav/todo-counts` (`leadMentorId`) | archived programs raise no lead todos |

`includeArchived=true` is only honored for board/sysadmin — a plain caller cannot
pass it to unhide archived rows, and `archivedAt` is tier `internal` so the
stripped `GET /api/programs/[id]` surface only returns it to board/sysadmin anyway.

**Deliberately NOT hidden:** a member's own enrollment view (`GET /api/programs/mine`)
— that is enrollment *history*, not a catalog/dashboard/picker; a family should
still see a program they are enrolled in even after the board archives it.

### 3b. New activity blocked (4xx, before any Shopify side effect)

Archiving freezes the seat-consuming / seat-mutating actions. The shared guard
`programArchivedError(program)` (`src/lib/program/archive.ts`) returns a
**409 Conflict** (state conflict, not an over-ridable soft limit), and it fires
**before** any Shopify inventory hold/decrement, so a blocked action can never leak
inventory (respecting the single-pool capacity model, `PROGRAM_CAPACITY_AND_SCHOLARSHIPS.md`):

| Action | Route | Guard placement |
|---|---|---|
| Enrollment | `POST /api/programs/[id]/participants` | right after the program lookup, **before** the capacity-lock transaction. Blocks even a board "force-enroll" override — archived is a hard freeze, unlike closed/age/capacity which override may bypass; unarchive first. |
| Payment-plan / scholarship request | `POST /api/programs/[id]/request-payment-plan` | **before** the `-1` hold decrement (`adjustProgramInventory`), so no phantom hold on an archived program. |
| Volunteer signup | `POST /api/programs/[id]/volunteers` (POST) | after the program lookup, before the assignment insert. |
| Capacity edit pushing to Shopify | `PATCH /api/programs/[id]` | the `maxParticipants` → `adjustProgramInventory` propagation is skipped when the (resulting) program is archived; the DB value still saves, with a warning telling ops to un-archive to sync. |

**Not blocked (deliberate):** reading rosters/history; participant *removal*
(withdrawal is an exit, not new activity — and a board may still need to tidy a
roster); metadata edits and phase/enrollment changes via PATCH (only the
Shopify-capacity push is frozen); event/session creation (not in the decided
blocked set — and the archived program is absent from the session-creation picker
anyway). Lead-mentor read access to their archived program's roster is preserved:
`buildCallerContext` (`src/security/access-resolvers.ts`) is **left untouched**, so
archiving is a visibility/activity decision, not an ACL change — history stays
readable exactly as before.

### 3c. Crons skip archived programs

The cron sweeps that act *on* programs add `program: NOT_ARCHIVED` to their query.
Full touched / not-touched table:

| Cron | Touches programs? | Change |
|---|---|---|
| `cron/pending-participants` (non-payment kick) | yes — kicks `PENDING` non-payers | `program: NOT_ARCHIVED` — an archived program's pending rows are not swept |
| `cron/scholarship-grace-expiry` (release path c) | yes — auto-withdraws denied holds | `program: NOT_ARCHIVED` — no auto-withdraw / +1 on archived programs |
| `cron/post-event` + `cron/nightly` (post-event leg) | yes — post-event emails per `event.program` | `program: NOT_ARCHIVED` added in `lib/postEventEmails.ts` — no post-event nag for archived programs |
| `cron/nightly` (facility-close leg) | no — operates on abandoned `Visit`s | untouched |
| `cron/membership-renewals` | no | untouched |
| `cron/person-bg-annual` | no | untouched |
| `cron/trusted-adult-expiry` | no | untouched |

## 4. Data model

```
Program.archivedAt  DateTime?   // NULL = live; timestamp = archived-at instant
```

- Migration `20260708020000_program_archive`: a single additive, nullable column.
  No backfill, no data touched, no index — NULL is exactly "not archived", so every
  existing program keeps its current behavior. Expand-only (no contract step needed;
  nothing is being removed).
- Un-archive sets the column back to `NULL`; the archive timestamp is **not**
  re-stamped when PATCH is saved on an already-archived program (only the
  `NULL → now` and `→ NULL` transitions write), so the original archive instant is
  preserved across unrelated edits.
- The change is audited by the existing PATCH `EDIT` audit-log entry (old/new
  `archivedAt` captured) — no bespoke audit action.

## 5. Prod safety

- Additive nullable migration; no lock-heavy backfill, safe under the repo's
  expand-contract convention (`DEPLOY_MIGRATION_ORDER_OF_OPERATIONS.md`).
- No Shopify calls are made on archive/un-archive in this PR (see §6). Archiving a
  program does not touch its live listing or inventory here.
- The block guard fires before any inventory mutation, so an archived program can
  never be pushed into an over-/under-sell during the freeze.

## 6. Deliberately deferred

- **Shopify-side archiving.** Archiving a program *should* eventually also archive
  its Shopify listing (and/or zero its inventory so the store stops selling seats
  for a retired program). That is handled by a **sibling PR**; this PR intentionally
  makes **no** Shopify-side change on archive/un-archive. Integration point: the
  `archived` transition in `PATCH /api/programs/[id]` is where a future Shopify
  archive/inventory-zero call would hang.
- **Bulk archive** (archive many programs at once) — not requested; single-program
  action only.
- **Auto-archive** (e.g. archive N months after `FINISHED`) — not requested; the
  board archives explicitly.
</content>
</invoke>
