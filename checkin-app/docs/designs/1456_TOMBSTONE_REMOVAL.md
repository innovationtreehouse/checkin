# Remove `LIVE_PERSON`: tombstone exclusion becomes structural

Issue: [#1456](https://github.com/innovationtreehouse/checkin/issues/1456) · Status: **PROPOSED — for review**

## Problem

When two duplicate person records are merged, the loser is not deleted — it stays in the database
forever as a "tombstone". Every part of the app that reads people therefore has to remember to
exclude tombstones, or it silently shows and counts a person who no longer exists.

Remembering is left to the developer. There are **113 places** that have to get it right, across 40
files. Getting it wrong produces no error of any kind — just a ghost in a roster, a wrong count, or
a write that lands on a dead record. It has already happened three times, and the automated check
built to catch it missed all three.

## Objective

**Make it impossible to read a merged-away person, rather than everyone's job to remember not to.**

Concretely: delete the `LIVE_PERSON` filter and its drift guard, by removing the tombstones they
exist to hide.

## Executive summary

| | |
|---|---|
| **The fix** | Stop creating tombstones. The merge either absorbs the loser completely or refuses to run. |
| **Why that's possible** | The merge already moves everything to the survivor. Rows are left behind in one situation only: a unique-constraint collision (the same human enrolled in the same program twice). |
| **What board members see** | Merges get stricter: "unenroll one of these from Program X first." Clear-up surfaces already exist for nearly all cases. |
| **What developers stop doing** | Remembering `LIVE_PERSON` on 113 queries. It, the drift guard, and its 31-entry allowlist all get deleted. |
| **What replaces the tombstone** | A `PersonMerge` record (from, to, when, snapshot). Badge scans and audit history keep working. |
| **Done when** | No `Person` row has `mergedIntoId`; the column, the filter, and the guard are gone. |
| **Deliberately not included** | #1134 (permission-based row visibility) and #1228 (`archivedAt`). See [Out of scope](#out-of-scope) — this issue has to be able to close. |

The trade being made: **merges become harder in exchange for the whole bug class disappearing.** A
merge that today silently parks an ambiguity now stops and asks a human to resolve it first — which
is also the better answer on its own merits, since the ambiguities are things like "which of these
two tool certifications is real".

## How it breaks today

`LIVE_PERSON` ([`lib/person/filters.ts`](../../src/lib/person/filters.ts)) is
`{ mergedIntoId: null }` — an **opt-out** convention. A merged-away Person is a tombstone: the row
survives forever, so every Person query must remember the filter or silently read a ghost.

**113 usages across 40 files, plus a 31-entry allowlist** on the drift guard. Forgetting produces no
compiler error and no runtime error — a stale row in a list, or a write landing on a dead record.

### It has already failed three times

| Bug | Effect |
|---|---|
| [#1448](https://github.com/innovationtreehouse/checkin/pull/1448) | The merge's own lead-count guard counted tombstones, **falsely blocking** legitimate merges with a message naming members that don't exist |
| [#1450](https://github.com/innovationtreehouse/checkin/pull/1450) | Tombstones leaked into the "needs a lead" household surfaces |
| `review.ts:305` | The background-check blanket stamp (fixed under [#1260](https://github.com/innovationtreehouse/checkin/issues/1260) / PR [#1454](https://github.com/innovationtreehouse/checkin/pull/1454)) |

`livePersonDriftGuard.test.ts` exists to catch precisely this class, and **missed all three.** Its
matcher is `\b(?:prisma|tx|db)\.person\.(findMany|findFirst|count|aggregate|groupBy)\(` plus nested
pulls keyed on `person:`. So it sees neither `tx.person.updateMany` (no write verb in the pattern)
nor a Person-typed relation named `householdMembers` (a `findUnique`, and not keyed `person:`).

A chip is widening it along both axes now. **That is mitigation, not a fix** — the guard is a regex
over source text, so new blind spots are a matter of time. The correct move is to remove what it
guards.

## Why the tombstone exists — and why it needn't

The merge already **repoints** to the survivor: visits, plus `programParticipant`,
`programVolunteer`, `rSVP`, `feePayment`, `toolStatus`, `backgroundCheckAttestation`,
`corporationLead`, `corporationMember`, and a further set via straight `updateMany` (`account`,
`orgMembershipProcess`, `program.leadMentorId`, `trustedAdult` ×2).

Rows stay behind in exactly one situation: a **unique-constraint collision** — the same human holds
a row on both records for the same program / event / tool / process, so the FK cannot be repointed.
[`merge/route.ts:257`](../../src/app/api/membership-ops/participants/merge/route.ts) states the
coupling outright:

> leave the colliding row on the tombstone (both survive; §3's LIVE_PERSON filter excludes the
> tombstone's from every count/roster)

That is the whole dependency. The tombstone is **a parking space for collision residue**, plus a
redirect target for badge scans. Neither job requires it to be a `Person` row — and the parking
space is what forces 113 call sites to know about it.

## Design

### 1. Merge refuses ambiguity instead of parking it

**Rule: refuse when the collision carries a decision; auto-dedupe only bare join rows with no
distinguishing payload.**

| Collision | Verdict | Rationale |
|---|---|---|
| `BackgroundCheckAttestation` | **refuse** | Means one human attested twice under two identities — the exact thing the two-distinct-reviewer rule forbids. A conflict-of-interest signal to investigate, not reconcile. Dropping one row also changes the approval count, which can retroactively clear or un-clear a check. |
| `ProgramParticipant` | **refuse** | Seat, payment, and downstream RSVPs. "Unenroll one of these from Program X first." |
| open `Visit` on both | **refuse** | "Close one of these visits first" — strictly better than the three bad alternatives below. |
| `ToolStatus` | **refuse** | Highest-wins is tempting, but silently raising a machinery certification during a data-hygiene operation is the wrong place for that to happen. |
| `RSVP` | **refuse — future events only** | Two answers to one upcoming event needs a human. A past event's RSVP is inert. |
| `FeePayment` | **refuse** | Money. Likely moot — [#1444](https://github.com/innovationtreehouse/checkin/pull/1444) drops `Fee`/`FeePayment`. |
| `ProgramVolunteer`, `CorporationLead`, `CorporationMember` | **auto-dedupe** | Bare join, no payload, same human, same entity. Nothing to decide. |

This inverts the model: today the merge absorbs everything and `LIVE_PERSON` cleans up after it
forever; here the merge is a **precondition-checked operation that either completes cleanly or
refuses**. [#1451](https://github.com/innovationtreehouse/checkin/pull/1451) ("refuse a person merge
across mismatched household membership") is the same pattern already landing — match its shape.

**Refusal is only viable if every refusable condition has a cleanup path.** Verified present:
`DELETE /api/programs/[id]/participants`, `/api/events/[id]/rsvp`, `/api/shop/certifications`,
`/api/attendance/manual/[id]`. **One gap:** `BackgroundCheckAttestation` has no user-facing removal —
attestations are deleted only by `overrideBlocked` in `reset`, and only for a `BLOCKED` process. A
refusal there is currently a dead end. Given what that collision signals, a sysadmin-only path with
an audit trail is probably right, but it must be built or those merges become impossible.

**The error message is the feature.** "Cannot merge" without naming the exact program, event, or
visit — and linking to where to fix it — converts a good invariant into a wall.

### 2. Resolve the existing stock

Refusal fixes the **flow**, not the **stock**: every tombstone already carrying parked residue from a
past merge still needs one-time resolution. The widened drift guard's allowlist is the scoping input
— each entry is a code path that depends on tombstones existing today.

Per [the AWS/board-surface precedent](1260_BG_PER_ADULT_SUBJECT.md), prefer an in-app worklist over a
script if the volume warrants a human decision per row; a pure count of collisions should be gathered
first to decide which.

### 3. Archive, then delete

With no dependents, the tombstone becomes a record rather than a row:

```prisma
model PersonMerge {
  id        Int      @id @default(autoincrement())
  fromId    Int      // the merged-away person's original id — no FK; the row is gone
  toId      Int
  to        Person   @relation(fields: [toId], references: [id])
  mergedAt  DateTime @default(now())
  snapshot  Json     // identity fields as they stood, for audit
}
```

- **Badge scan** ([`api/scan/route.ts:61-73`](../../src/app/api/scan/route.ts)) currently walks
  `mergedIntoId` to the survivor; it reads `PersonMerge` instead. Same loop, same cap.
- **`AuditLog.affectedEntityId`** is a bare `Int` with no FK, so historical audit references survive
  a deleted `Person`.
- `Person.mergedIntoId`, `mergedInto`, and `mergedFrom` are dropped.

### 4. Delete the guard

`LIVE_PERSON`, `livePersonDriftGuard.test.ts`, and its 31-entry allowlist all go. Every one of the
113 call sites loses its filter — mechanical, and `tsc` catches the import removals.

## Decisions needed (policy, not plumbing)

1. **Per-table collision rules.** The table above is a proposal; the `ToolStatus` ladder (`DOF`
   outranks `CERTIFIED` despite the enum declaration order) and the `ProgramParticipant`
   seat/payment interaction want their owners' sign-off.
2. **The open visit.** [`merge/route.ts:246-253`](../../src/app/api/membership-ops/participants/merge/route.ts)
   deliberately leaves the tombstone's open visit when the keeper already has one — *"no delete, no
   fabricated departedAt"*, with a `ponytail:` note preferring the left row to an invented departure
   time. Removing tombstones forces the question: fabricate a `departedAt` (what the code refuses),
   move it and hold two open visits (breaks the invariant), or delete an attendance record (a safety
   record in a youth organisation). Refusing the merge until the visit is closed is the proposed
   answer, and it is the only one that invents nothing.
3. **The attestation cleanup path** (see the gap above).

## Out of scope

- **[#1134](https://github.com/innovationtreehouse/checkin/issues/1134) declarative row visibility.**
  Similar-looking, different mechanism. #1134 is **permission** — *which rows a given caller may
  see*, per-caller and contextual, the row analogue of `@sensitivity`. Tombstone exclusion is
  **caller-independent**: a tombstone is never visible to anyone, ever. Folding this into #1134 would
  make both larger and neither closeable. Deliberately separate.
- **[#1228](https://github.com/innovationtreehouse/checkin/issues/1228) `Household.archivedAt`.** A
  second exclusion dimension. Built the current way it would mint a second forgettable convention and
  a second drift guard — worth a comment on that issue **once this design is agreed**, not folded in
  here.
- Any general soft-delete or archival framework. This issue closes when `LIVE_PERSON` is gone.

## Migration / safety notes

- **Live data.** Deleting `Person` rows is irreversible; the archive write and the delete must be one
  transaction, and the stock resolution (§2) must complete and be reviewed before any delete runs.
- **Dropping `mergedIntoId`** is a destructive schema change and lands last, after §1–§3 are live and
  the column reads zero. It touches the security boundary (generated classifications, `scopeBindings`)
  and therefore ships in its own PR per the boundary-isolation rule in `AGENTS.md`.
- **Ordering vs. #1454.** `review.ts:305`'s `LIVE_PERSON` omission is fixed independently there; no
  conflict, and this design removes the need for that filter entirely once it lands.
- **`tsc` is not sufficient** for §1. The collision rules are behavioural; they need integration
  coverage per table, including the refuse-path assertions.

## Test plan

- Each collision class: merge refuses, with the refusal naming the specific colliding entity.
- Each auto-dedupe class: merge completes, one row survives, no residue on either record.
- After a successful merge: **the merged-away `Person` row no longer exists**, and a `PersonMerge`
  row records it.
- Badge scan against a merged-away id resolves to the survivor via `PersonMerge`, including the
  multi-hop chain the current `mergedIntoId` walk caps.
- An `AuditLog` row referencing a deleted person still renders.
- Regression: the three shipped bugs (#1448, #1450, `review.ts:305`) become **unrepresentable** — no
  tombstone exists to count, list, or stamp.
