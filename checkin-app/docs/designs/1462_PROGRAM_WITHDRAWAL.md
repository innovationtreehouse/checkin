# Program withdrawal: an exit that leaves a trace

**Issue:** #1462 · **Status:** design. No production code accompanies this doc.

Leaving a program hard-deletes the enrollment row. `withdrawAndReleaseHold`
([capacity.ts:66](../../src/lib/program/capacity.ts)) `delete()`s the
`ProgramParticipant`, and it is the only exit path. So a person who withdrew and
a person who was never enrolled look identical afterwards: there is no row to
read. That is the gap — the system cannot tell "done" from "never here."

The fix is a single new state on the participant row, on a single code path.
**Removal is not always a withdrawal**, and this design leans on that:

- **Delete (never-there)** — the program hasn't started, or an early no-show. No
  participation happened; nothing is worth keeping. `delete()` stays, and with it
  today's exactly-once hold-ledger boundary — untouched.
- **Withdraw (was-here-then-left)** — real participation, then an exit. Record it
  and stop deleting.

Everything downstream that over-counts "attached" people (background-check
obligations, the board compliance chase list) then keys off a status it can
actually read, instead of the absence of a row.

The broader "done with the Treehouse" question — program-end cleanup, an
org-level exit stamp, youth graduation, and the volunteer/mentor side of the same
gap — is explicitly **not** here. See §6.

---

## 1. What the code does today

| Fact | Where |
|---|---|
| `ProgramParticipantStatus` is `PENDING \| ACTIVE` — no exit value | [schema.prisma](../../prisma/schema.prisma) `enum ProgramParticipantStatus` |
| `ProgramParticipant` PK is composite `@@id([programId, personId])` — one row per (person, program), ever | [schema.prisma:1038](../../prisma/schema.prisma) |
| `withdrawAndReleaseHold` `delete()`s the row; `delete()` **is** the exactly-once boundary for the scholarship-hold +1 | [capacity.ts:56-81](../../src/lib/program/capacity.ts) |
| `inventoryHeldAt` NOT NULL is already "the transactional guard every release path checks before adjusting Shopify" | [schema.prisma:1013-1021](../../prisma/schema.prisma) |
| The attached-person predicate's participant arm is `{ programParticipants: { some: {} } }` — attached to any program **ever** | [filters.ts:22-28](../../src/lib/person/filters.ts) `PROGRAM_ATTACHED_WHERE` |
| The withdraw state transition is modelled as `T9 withdraw … delete() = atomicity boundary` | [enrollmentState.ts:218](../../src/lib/programs/enrollmentState.ts) |

**Two callers of the exit path, not three.** The issue body lists a "non-payment
kick" as a third deleting caller — that is stale. `cron/pending-participants` no
longer removes anyone; it warns the household and flags the board ("No longer
auto-removed — flagged for the board to act on",
[route.ts](../../src/app/api/cron/pending-participants/route.ts)). The board then
acts through the manual route. So `withdrawAndReleaseHold` has exactly two live
callers:

1. **Manual removal** — `DELETE /api/programs/[id]/participants`
   ([route.ts:305](../../src/app/api/programs/[id]/participants/route.ts)). Also
   where a board member acts on a flagged non-payment overdue.
2. **Grace-expiry** — `cron/scholarship-grace-expiry`
   ([route.ts:48](../../src/app/api/cron/scholarship-grace-expiry/route.ts)). The
   row sits in `PENDING_HELD_DENIED` the whole time: denied a plan, never paid,
   timed out.

## 2. The design

**One new enum value and one timestamp.**

```
enum ProgramParticipantStatus { PENDING  ACTIVE  WITHDRAWN }
```

Add `endedAt DateTime?` to `ProgramParticipant`. `WITHDRAWN` drives the attached
predicate (§4); `endedAt` gives the honest attachment *window* #1224 wanted for
the copy explaining why a person was flagged. Status alone can't say *when*.

**The withdraw path stops deleting; the delete path stays.** `withdrawAndReleaseHold`
splits by intent:

- `deleteAndReleaseHold(...)` — today's function verbatim, `delete()` and all. The
  never-there exits use it.
- `withdrawAndReleaseHold(...)` — sets `status = WITHDRAWN, endedAt = now()` and
  releases the hold under the new guard in §3, keeping the row.

## 3. Which path each caller takes

`PENDING | ACTIVE` already encodes "were they ever really in," and both automatic
exits only ever touch `PENDING` rows. So:

| Caller | Path | Why |
|---|---|---|
| Grace-expiry cron | **delete** | `PENDING_HELD_DENIED` — never paid, never active, never participated |
| Manual removal, operator picks | **delete** or **withdraw** | Two buttons: *"never showed → remove"* vs *"withdrew → keep history"* |

The manual button's **default** falls out of the status: a `PENDING` row defaults
to *remove*, an `ACTIVE` row defaults to *withdraw*. The operator overrides only
the odd case (an `ACTIVE` person who genuinely never attended). This matches the
board-driven, out-of-band pattern the rest of membership enforcement already uses;
no attendance heuristic is invented here.

Net: the whole withdraw-with-history machinery lives on **one path**, the manual
one. The cron keeps deleting exactly as today.

## 4. The exactly-once hold-ledger guard

Today `delete()` is the atomicity boundary: a row deletes at most once, so the
scholarship +1 can't double-fire even under concurrent callers, and a second
delete throws P2025 which callers treat as an idempotent no-op
([capacity.ts:56-60](../../src/lib/program/capacity.ts)). Keeping the row on
withdrawal removes that boundary, so the withdraw path needs a new one.

`inventoryHeldAt` already **is** the guard the schema describes — NOT NULL means
"a seat is held; release it exactly once." Make the release an atomic conditional
clear and let the row count decide the +1:

```ts
const { count } = await tx.programParticipant.updateMany({
  where:  { programId, personId, inventoryHeldAt: { not: null } },
  data:   { status: 'WITHDRAWN', endedAt: new Date(), inventoryHeldAt: null },
});
// count === 1 → we won the race, do the Shopify +1. count === 0 → already released, no-op.
```

A concurrent second caller matches zero rows (`inventoryHeldAt` is already null),
returns `count: 0`, and skips the +1 — the same idempotent outcome the P2025
path gives today, without deleting. A withdrawal of a row that never held a seat
(`inventoryHeldAt` already null) sets the status in a separate unconditional
update and releases nothing, mirroring the `!inventoryHeldAt` early-return today.

## 5. Re-enrollment — the composite-PK consequence

The PK is `@@id([programId, personId])`: **there can only ever be one row per
person per program.** Today a re-enrol works because withdrawal deleted the row.
Keep the row and a re-enrol collides with the PK.

Resolution: **re-enrolment reactivates the existing row** — `WITHDRAWN → PENDING`,
clear `endedAt`, run the normal capacity/hold logic — rather than inserting. The
enrol path becomes an upsert on the composite key. This keeps the schema as-is and
keeps "attached now?" a single-row question.

<!-- ponytail: one row per (person, program) keeps only the LAST stint's exit.
     Multi-stint history (someone who enrolled, withdrew, and came back across
     years) would need a surrogate PK and a stint table — deferred until a
     consumer actually needs the full arc; BG/compliance only need current state. -->

## 6. Downstream: the payoff, and what stays put

Narrow the participant arm of `PROGRAM_ATTACHED_WHERE`
([filters.ts:22](../../src/lib/person/filters.ts)):

```ts
{ programParticipants: { some: { status: { not: 'WITHDRAWN' } } } },
```

That one line drops people who actually withdrew out of `BG_OBLIGATED_WHERE`, so
`PERSON_BG` obligations and the board compliance chase list
([compliance/route.ts](../../src/app/api/membership-audit/compliance/route.ts))
stop chasing them. The other two arms (`programVolunteers`, `programsLed`) are
**not** touched here — that is #1803.

`enrollmentState.ts` T9 and its equivalence oracle assert `delete() = atomicity
boundary`; both change to the row-kept guard. Expect the oracle count and the
drift/mock tests around the enrollment states to move — full jest is the net, not
tsc.

## 7. Out of scope — spun off

#1462 is the participant withdraw exit state only. The rest of "done with the
Treehouse" is separate, each its own issue:

- **#1800** — program-end cleanup: stale rows nobody ever exits (program-lifecycle
  trigger, not a person action; narrows the predicate by program window).
- **#1801** — board "no longer with us" / "graduated" per-person org-level exit
  stamp (needs a board policy decision).
- **#1802** — school year / expected-exit year on youth (derived, youth-only).
- **#1803** — exit state for `ProgramVolunteer` and `Program.leadMentor` (same
  gap, other two arms of the predicate, no scholarship-ledger coupling).

## 8. Migration & phasing

One additive migration: the new enum value and the nullable `endedAt`. Both are
backward-compatible with old code still serving traffic during the rolling deploy —
`WITHDRAWN` is never written by the old binary, and a nullable column defaults to
null. No backfill: existing rows are `PENDING`/`ACTIVE` and stay valid. The
predicate narrowing and the write-path split ship in the same release as the
migration, after it lands. See `DEPLOY_MIGRATION_ORDER_OF_OPERATIONS.md`.
