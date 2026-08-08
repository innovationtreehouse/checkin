# Merge-time background-check carryover

Issue: [#1396](https://github.com/innovationtreehouse/checkin/issues/1396)
· Scope, related work, and why this is a design rather than a patch in the
[appendix](#appendix--why-this-is-a-design-and-what-scoping-found).

**Still a proposal.** Nothing here is authority; no `docs/designs/` document governs
this work.

## Re-grounding against `a00331fa`

Everything below was re-verified against `main` at `a00331fa`. What changed:

| Claim as written | Status now |
|---|---|
| Diagnosis — merge moves `lastBackgroundCheck`, nothing re-derives `bgClearedAt` | **holds.** `resolveKeeperUpdate` takes the newer date ([route.ts:97-103](../../checkin-app/src/app/api/membership-ops/participants/merge/route.ts:97)); the route mentions `bgClearedAt` / `householdBgIsFresh` / `clearBackgroundCheck` / `applyVolunteerStatus` nowhere. |
| Only three edges enter `PENDING_BG_REVIEW` | **holds**, re-derived from `TRANSITIONS` and from every writer of the literal: [external.ts:113](../../checkin-app/src/lib/membership/external.ts:113), [personBgTriggers.ts:52](../../checkin-app/src/lib/membership/personBgTriggers.ts:52), [review.ts:445/448](../../checkin-app/src/lib/membership/review.ts:445). |
| …therefore a household application cannot sit at `PENDING_BG_REVIEW` without a live note | **overstated — see [the note-deleted population](#the-note-deleted-population).** Both household edges require the note *at transition time*; neither keeps it there. |
| Item 3 — duplicate `PERSON_BG` after a merge | **dead.** Fixed on `main` by [#1449](https://github.com/innovationtreehouse/checkin/pull/1449) (`archiveDuplicatePersonBg`, [route.ts:127](../../checkin-app/src/app/api/membership-ops/participants/merge/route.ts:127)). |
| Item 4 — lead guard counts tombstones | **dead.** Fixed on `main` by [#1448](https://github.com/innovationtreehouse/checkin/pull/1448) — the guard's `householdMembers` include carries `LIVE_PERSON` ([route.ts:203](../../checkin-app/src/app/api/membership-ops/participants/merge/route.ts:203)). |
| Item 1b — `LIVE_PERSON` missing from the "needs a lead" surfaces | **still live**, `BROKEN_HOUSEHOLD_WHERE` unchanged ([household/filters.ts:12](../../checkin-app/src/lib/household/filters.ts:12)). [#1450](https://github.com/innovationtreehouse/checkin/pull/1450) open. |
| Item 2 — merge never compares the two households' membership states | **still live.** [#1451](https://github.com/innovationtreehouse/checkin/pull/1451) open. |
| Items 1 / 5 — orphaned process, "which process does the carryover act on" | unchanged. |
| "A person-scoped freshness predicate doesn't exist" (the reason `PERSON_BG` is scoped out) | **false, and was false when written.** `personBgVerdict` ([personBgCheck.ts:57](../../checkin-app/src/lib/membership/personBgCheck.ts:57)) is exactly that predicate, is pure, and is already `openPersonBg`'s own guard. Scoping `PERSON_BG` out is now a *choice*, not a blocked path — see [PERSON_BG](#person_bg-is-a-separate-question). |
| No COI check on the merge route | **holds.** `withAuth({ roles: ['isSysadmin','isBoardMember'] })` ([route.ts:165](../../checkin-app/src/app/api/membership-ops/participants/merge/route.ts:165)) and no `hasHouseholdConflict` anywhere in the file. |
| `householdBgIsFresh` closes over the module `prisma` client | **holds** ([renewal.ts:319](../../checkin-app/src/lib/membership/renewal.ts:319)). Three call sites, one of which drifted: `intake.ts:392`, `renewal.ts:191`, `compliance/route.ts:53`. |

Two consequences of the dead items: the *What the two-sided view does surface* list is
six items long but only four are still open, and #1449 removed the stated reason
`PERSON_BG` could not be cleared from a merge (the carryover would have had to pick
between duplicates — there are no duplicates now).

Line references throughout have been re-anchored to `a00331fa`.

## Problem

Two records for the same person get merged, as happens whenever a family is entered twice. The
surviving record inherits the newer background-check date, on the reasoning that it is the same
human either way.

Their family's membership application does not notice. It stays parked, waiting on a
background check the household demonstrably already has. The board is asked to run a fresh
two-person review of a check that exists and is still valid, and the family waits while they do.

Nothing is *wrong* in the data — the date is real and the application really is unapproved. The two
simply stopped agreeing, because merging a person updates the date without revisiting anything
derived from it.

## Objective

**When a merge gives a household a valid background check it did not previously have, the
household's in-flight application should notice.**

Two constraints. It must not weaken any existing review requirement — in particular it must not
release an application a human is deliberately holding. And it must not become a way for one board
member to advance their own household's membership.

## Executive summary

| | |
|---|---|
| **Families** | An application blocked only by a check the household already holds stops waiting. No change to anything they do. |
| **Board** | One less redundant two-person review per affected merge. A merge that *cannot* safely clear says so, and nudges the reviewers instead of failing silently. |
| **Where it applies** | Three application states, plus a narrow residue of the one the issue names — see [state matrix](#the-state-matrix). |
| **Deliberately unchanged** | Household freshness rollups, the two-reviewer rule, and any application held for a human to read a note. |
| **New guard** | The merge gains a conflict-of-interest check. Without one the carryover is a way to clear your own family. |
| **Cost** | A shared helper extracted from the existing clearance path, one call inside the merge's existing transaction, one threaded database-client parameter. No schema change. |
| **Blocked on** | Three board decisions, below. One of them determines most of the value. |

The reason this is not a small patch: the mechanical change *is* small, and almost everything
load-bearing about it is a policy question the code cannot answer on its own.

## Rules this design obeys

The rules register (`docs/rules/`) does not exist yet — [#1445](https://github.com/innovationtreehouse/checkin/pull/1445)
introduces it. Collapse this to a pointer once it lands.

1. **A valid prior check satisfies the requirement without a fresh review.** Already settled
   policy, not a concession made here: application intake and renewal both accept a still-valid
   household check as a complete substitute for the two-reviewer pass, with no reviewers involved.
2. **One human may not stand in for a second reviewer.** A review still open to its second reviewer
   is never force-cleared by one person. Rule 1 is not a loophole in this — it is the requirement
   being *met by evidence*, not a judgement substituted for the missing reviewer.
3. **Nobody decides their own household's compliance.** Every other path that touches
   background-check clearance refuses when the actor shares a household with the applicant, and no
   role bypasses it. The merge currently has no such check because deduplicating people is not a
   membership decision — this design makes it one.
4. **An applicant's note reaches a human before payment opens.** What that obliges once payment has
   opened is [open question 0](#open-questions); it is the question this design most needs answered.

Rules 1 and 2 together are why this is a legitimate clearance rather than an override. Rule 3 is
the one requirement here that is not negotiable on cost.

## Two sides, not one

A merge has two people, each possibly in a household with its own in-flight process, plus a
`PERSON_BG` apiece. Enumerating that cross product is hopeless and unnecessary — it factors.

**The predicate reads exactly one thing:** live household leads and their dates.
`householdBgIsFresh(H)` ⟺ ∃ person in `H` with `isHouseholdLead: true`, `LIVE_PERSON`, and
`lastBackgroundCheck ≥ threshold` ([renewal.ts:319](../../checkin-app/src/lib/membership/renewal.ts:319)).

**The merge writes exactly two inputs to it:**

1. the keeper's `lastBackgroundCheck` — **can only increase**, since `resolveKeeperUpdate` always
   takes the newer of the two and this is never a radio
   ([route.ts:97-103](../../checkin-app/src/app/api/membership-ops/participants/merge/route.ts:97));
2. the tombstone's `isHouseholdLead` → `false`, plus `mergedIntoId` set, which drops it out of
   `LIVE_PERSON` ([route.ts:267-281](../../checkin-app/src/app/api/membership-ops/participants/merge/route.ts:267)).

**And a pre-tx guard bounds the second one.** The merge refuses outright when the tombstone is a
lead of a household that still has other *live* members
([route.ts:218-223](../../checkin-app/src/app/api/membership-ops/participants/merge/route.ts:218), counting
through the `LIVE_PERSON`-filtered include #1448 added):

```
if (isLead && householdOthersCount > 0) → 400
```

That guard is what makes this tractable. It yields:

| tombstone is | its household's lead set | effect on its household's freshness |
|---|---|---|
| **not a lead** | unchanged | **none** — the predicate never read it |
| **a lead, others present** | — | **merge refused** |
| **a lead, sole member** | live-emptied | goes false, but the household now has **zero live members** |

Two consequences settle the whole two-sided question:

- **Same household on both sides ⇒ pure advance.** If both are in `H`, the keeper is an "other
  member", so a lead tombstone is refused. The tombstone must be a non-lead, so `H`'s lead set is
  untouched and only the keeper's date can move — upward.
- **Different households ⇒ the tombstone's household is unaffected or live-emptied.** Never
  "stale but still populated".

**Therefore every household's BG freshness is monotone non-decreasing under a merge, except a
household the merge live-empties.** The carryover only ever acts on the **keeper's** household process,
because that is the only one that can improve. The one-sided state matrix below is sound — but it
is sound *because of the lead guard*, which is worth stating rather than assuming.

### What the two-sided view does surface

Six things a one-sided reading hides. None are carryover bugs; five are pre-existing, and one
(item 2) is more serious than #1396 itself. Items 1b and 4 share a root cause: `LIVE_PERSON` is
applied inconsistently, so tombstones leak into reads that mean "live members".

**Two of the six are dead as of `a00331fa`:** item 3 (duplicate `PERSON_BG`) shipped in
[#1449](https://github.com/innovationtreehouse/checkin/pull/1449) and item 4 (the lead guard
counting tombstones) in [#1448](https://github.com/innovationtreehouse/checkin/pull/1448). They
are kept below with their fixes noted, because the reasoning around them still carries weight —
item 3's disappearance in particular removes the stated obstacle to clearing a `PERSON_BG`.

**1. Orphaned process on a live-emptied household — auto-archive is the right answer.** Tombstone
was the household's only live member (a sole-member lead, or equally a sole-member non-lead, which
the guard never inspects). Post-merge the household holds a live in-flight process and no live
member — possibly with `bgClearedAt` already stamped from a check that has now walked out.

**"Empty" is imprecise.** The merge does not move `householdId`
([route.ts:420](../../checkin-app/src/app/api/membership-ops/participants/merge/route.ts:420)), so the
tombstone stays in the household as a row. `LIVE_PERSON` is only `{ mergedIntoId: null }`
([person/filters.ts:12](../../checkin-app/src/lib/person/filters.ts:12)) — a filter, not a delete. The
household is **live-empty**: code that applies `LIVE_PERSON` sees zero members, code that doesn't
sees one.

The right disposal is `archiveApplication`
([archive.ts:16](../../checkin-app/src/lib/membership/archive.ts:16)) — *"Board disposal of an abandoned
application"*, which is exactly what this is. It is terminal-but-restorable
(`restoreApplication` replays the target from the audit log), idempotent, and already a declared
`TRANSITIONS` edge from every pre-terminal status. A process whose household has no live members
is abandoned by definition.

Two boundaries on that:

- **Never when the membership is `ACTIVE`.** `archiveApplication` already refuses with
  `wrong_phase` — someone paid for that membership. But note this is **defence in depth, not the
  fix**: a live-empty household holding an `ACTIVE` membership should never have been created, and
  the real remedy is the missing pre-tx guard in item 2 below. Keep the boundary for pre-existing
  rows; do not treat it as the answer.
- **The `Household` row itself stays** — but it is **not inert**, and archiving the process is not
  enough. See below.

Doing this **removes the orphan from this doc's concerns**: an `ARCHIVED` process's stale
`bgClearedAt` no longer matters, which is why [retraction](#out-of-scope) can stay out of scope
without leaving a hole. It is nonetheless a separate concern from background checks — abandoned-
application disposal, not clearance — so it wants its own issue and its own PR.

**1b. A live-empty household is not inert — it becomes a permanent false board to-do.** The shared
"needs a lead" predicate carries no live-person filter
([household/filters.ts:12](../../checkin-app/src/lib/household/filters.ts:12)):

```ts
export const BROKEN_HOUSEHOLD_WHERE: Prisma.HouseholdWhereInput = {
    householdMembers: { none: { isHouseholdLead: true } },
};
```

A live-emptied household matches this **by construction** — clearing `isHouseholdLead` on the
tombstone is exactly what the merge CAS does. So every merge that live-empties a household
permanently:

- adds a row to `/api/admin/broken-households`, rendering the **merged-away person's name** as its
  member (that `include` has no live filter either);
- adds a row to `/api/membership-audit/unclaimed-households`, via the `BROKEN` arm of
  `UNCLAIMED_OR_BROKEN_HOUSEHOLD_WHERE`;
- increments **two** nav to-do badges ([todo-counts/route.ts:397-403](../../checkin-app/src/app/api/nav/todo-counts/route.ts:397)).

And it is unfixable from the UI by design — the list's own comment says empty households are shown
"even though there's no one to promote". The board gets a monotonically growing pile of to-dos it
cannot action, generated by an operation it performs routinely.

`GET /api/safety/emergency-contacts` is worse in kind: it fetches **every** household with no
`where` at all and no live filter on `householdMembers`, so the keyholder-facing front-desk sheet
carries the household and the tombstone's name.

The two heavy surfaces do filter — `/api/membership-ops/households` and
`/api/membership-audit/compliance` both apply `LIVE_PERSON`. So this is **inconsistent application
of `LIVE_PERSON`**, not a uniform gap, which is why it reads as inert until you check.

**Fix: add the live filter to the shared predicates, not an archive column on `Household`.** The
codebase already has `LIVE_PERSON`; four surfaces just don't use it. That is cheaper than a
migration and consistent with how the other reads already work. Same root cause as item 4 below.

**Status:** still live at `a00331fa` — `BROKEN_HOUSEHOLD_WHERE` is unchanged. In flight as
[#1450](https://github.com/innovationtreehouse/checkin/pull/1450); not a dependency of this design.

**2. The merge never compares the two households' membership states — the most serious gap here.**
`OrgMembership` is 1:1 with `Household` (`householdId Int @unique`) and the merge **never touches
it**: the only membership write in the whole route is the `PERSON_BG` `subjectPersonId` re-point.
The tombstone's household keeps its membership; the keeper stays in the keeper's household. No
guard compares the two. That is destructive in both directions.

**Value destroyed.** Tombstone is the sole live member of a household whose membership is `ACTIVE`;
keeper's household is `NONE`. Post-merge the paid membership sits on a household with zero live
members, and the human — who is now the keeper record — is in a non-member household. They paid
and are no longer a member. Nothing in the route notices.

**Restriction laundered.** `DENIED` and `REVOKED` are *negative* state, and the login block is
derived **live from the person's household**:

```ts
const denied = orgMembershipStatusBlocksLogin(p.household?.orgMembership?.status);
```

([authClaims.ts:34](../../checkin-app/src/lib/authClaims.ts:34); `denied` then clears every role flag,
`householdLead`, `toolStatuses` and `programsLed`.) Merge a duplicate sitting in a `DENIED`
household into a record in a clean household and the surviving human is simply not denied any
more — on the next token refresh. The schema comment calls `DENIED` a login block "for every
member of the household"; merge walks straight out of it. This does not require live-emptying, so
the existing lead guard never fires.

**The fix is a pre-tx guard, not a downstream boundary.** Refuse the merge when the two
households' `OrgMembership.status` differ, and make the board resolve the membership first. Same
status on both sides is the safe case; every mismatch is a human decision:

| tombstone household | keeper household | today | should |
|---|---|---|---|
| `NONE` | `NONE` | merges | merge |
| `ACTIVE` | `ACTIVE` | merges | merge (board may still want to close the emptied one) |
| `ACTIVE` | `NONE` | merges — **membership stranded** | refuse |
| `DENIED` / `REVOKED` | anything weaker | merges — **restriction escaped** | refuse |

Moving or merging the two `OrgMembership` rows instead of refusing would be the richer answer, but
it drags in dues, Shopify orders and process history. Refusing is a few lines and safe; the board
already has the surfaces to close or transfer a membership by hand.

Independent of #1396 and more serious than it. **Given the app holds live data, this also wants a
one-off audit** for households already live-empty with a non-`NONE` membership, and for people
whose current household status is weaker than a tombstone's.

**Status:** still live at `a00331fa` — the route's only membership write remains the
`subjectPersonId` re-point. In flight as
[#1451](https://github.com/innovationtreehouse/checkin/pull/1451); not a dependency of this design.

**3. Duplicate `PERSON_BG` — FIXED on `main` by [#1449](https://github.com/innovationtreehouse/checkin/pull/1449).**
`archiveDuplicatePersonBg` ([route.ts:127](../../checkin-app/src/app/api/membership-ops/participants/merge/route.ts:127))
now runs inside the merge transaction right after the re-point: it ranks the survivor's open
`PERSON_BG` rows (`BLOCKED` first, then attestation count, then consent, then age) and archives the
rest under the declared `{PENDING_BG_REVIEW,BLOCKED}→ARCHIVED` edge. **A merge survivor now holds at
most one open `PERSON_BG`**, which removes this section's stated reason for scoping `PERSON_BG` out
of the carryover. The original finding, for the record:

Both sides can hold an open `PERSON_BG`. The merge re-pointed blindly:

```ts
await tx.orgMembershipProcess.updateMany({ where: { subjectPersonId: mergeId }, data: { subjectPersonId: keepId } });
```

There is **no dedupe and no constraint** behind it: `personBgTriggers` carefully checks for an
existing open row before creating one
([personBgTriggers.ts:56](../../checkin-app/src/lib/membership/personBgTriggers.ts:56)), and the two partial
unique indexes are on `orgMembershipId` only — neither covers `subjectPersonId`. So a merge could
leave **one human with two concurrent 2-of-N reviews**, each needing its own attestations. The
partial-unique-index situation is unchanged; #1449 resolves the duplicate in application code
inside the merge transaction rather than at the schema level.

**4. The lead guard counts tombstones — FIXED on `main` by [#1448](https://github.com/innovationtreehouse/checkin/pull/1448).**
The include feeding `householdOthersCount` now carries `LIVE_PERSON`
([route.ts:199-207](../../checkin-app/src/app/api/membership-ops/participants/merge/route.ts:199)), so a
household whose only other "member" is a previously-merged tombstone no longer produces a spurious
400. The analyze route's `householdMembers` select was filtered to match, so the page's
`isLeadWithOthers` guard and the POST agree.

**5. Which process does the carryover act on?** The keeper's household process, and only that one.
That is a derived fact from monotonicity, not a scoping choice.

## The predicate

The freshness half is uncontroversial: `householdBgIsFresh`
([renewal.ts:319](../../checkin-app/src/lib/membership/renewal.ts:319)) filters `isHouseholdLead: true` +
`LIVE_PERSON`, so the merge only changes the answer when the tombstone was **not** already a live
lead of the survivor's household.

The note half is where the issue comment's advice — *"the full predicate is
`!intakeNotes?.trim() && householdBgIsFresh(...)`"* — is right for intake and **wrong as a
universal merge rule**.

### Where the note is actually read

Four sites, all of them transitions that decide *whether review precedes payment*. None of them
read it at `PENDING_PAYMENT` or later.

| read | transition | effect of a note |
|---|---|---|
| [intake.ts:392](../../checkin-app/src/lib/membership/intake.ts:392) | `INTAKE → PENDING_EXTERNAL_ACTION` | don't stamp `bgClearedAt` |
| [renewal.ts:192](../../checkin-app/src/lib/membership/renewal.ts:192) | `PENDING_RENEWAL → PENDING_EXTERNAL_ACTION` | don't stamp |
| [external.ts:112](../../checkin-app/src/lib/membership/external.ts:112) | `PENDING_EXTERNAL_ACTION → {PENDING_PAYMENT ∣ PENDING_BG_REVIEW}` | hold at `PENDING_BG_REVIEW` |
| [review.ts:448](../../checkin-app/src/lib/membership/review.ts:448) | `BLOCKED → reset target` | resume at `PENDING_BG_REVIEW` |

**All four read the note at transition time only.** Nothing re-reads it while a row sits in the
state the note put it in, and nothing reacts when a lead deletes it. That is the whole content of
[the note-deleted population](#the-note-deleted-population) below.

**But where the code reads it does not establish what the board means by it.** `intakeNotes` is a
bare `String?` — free-text "anything else we should know?", carrying hardship / medical / family
disclosures ([people/search/route.ts:91](../../checkin-app/src/app/api/people/search/route.ts:91)). Nothing in
the schema records whether a human has ever *read* one. There is no `noteAcknowledgedAt`.

So there are two defensible readings, and the code cannot distinguish them:

- **Transition gate** — the note's job is to force a review before payment opens. Once past that
  point it has done its work. This is what the code implements today.
- **Standing human-review flag** — a note means *a human touches this household before anything
  automatic happens to it*, for reasons the software has no way to parse ("please call us before
  you clear anything", a disclosure whose relevance only a board member can judge).

The second reading is not hypothetical: reviewers are deliberately granted `everyones:pii` on
`GET /api/membership/reviews` **so they can read this field**
([schema.prisma:262-274](../../checkin-app/prisma/schema.prisma:262)). It is written to be read by humans.

The two readings agree at three states and disagree at the two that carry the fix's entire value.
Below, each state is answered under both.

### `PENDING_EXTERNAL_ACTION` — the note clause is load-bearing

`holdForNote = !process.bgClearedAt && !!intakeNotes?.trim()`. A merge stamp flips that to false,
and the row advances straight to `PENDING_PAYMENT`, skipping the review #907 exists to force.

**This is the only state where the merge can break the gate.** Apply `!note && fresh` here.

### `PENDING_BG_REVIEW` — `bgClearedAt` carries two facts, and the merge establishes only one

**The quorum objection does not apply here.** It is tempting to reach for `overrideBlocked`'s rule
— *"force-clearing a review still open to its second reviewer is what the two-reviewer rule
forbids"* ([review.ts:362](../../checkin-app/src/lib/membership/review.ts:362)) — since a `PENDING_BG_REVIEW`
row is exactly that. It is the wrong analogy:

- `overrideBlocked approve` is one human **substituting their judgment** for the missing second
  reviewer. Quorum exists to stop that.
- The carryover is the requirement being **satisfied by evidence**. Intake and renewal already
  treat a still-valid prior check as a *complete* substitute for the 2-of-N review — zero
  attestations, no reviewers involved ([intake.ts:392](../../checkin-app/src/lib/membership/intake.ts:392)).
  That is settled policy, not a loophole.

The partial attestation is likewise not an obstacle. A `REJECT` moves the row to `BLOCKED`
immediately ([review.ts:232](../../checkin-app/src/lib/membership/review.ts:232)), so a row still sitting at
`PENDING_BG_REVIEW` holds zero or one **APPROVE**. It simply no longer needs a second one.

**The actual obstacle is field overloading.** `bgClearedAt` means two things at once:

1. *the background-check requirement is satisfied* — the carryover makes this true;
2. *a reviewer has read this household's note* (#900/#907) — the carryover says nothing about it.

`clearBackgroundCheck` sets the field for both because in its world they always co-occur: two
reviewers approved **and** had the note on screen. And because the reviewer queue keys on
`bgClearedAt: null` ([lifecycle.ts:152-158](../../checkin-app/src/lib/membership/lifecycle.ts:152)), stamping
fact 1 silently removes the row from the only surface where fact 2 ever happens. That is exactly
the "stamping `bgClearedAt` alone strands the application" failure identified on the issue.

**And the stranding is worse than "invisible".** Re-derived at `a00331fa`, a `PENDING_BG_REVIEW`
row carrying a `bgClearedAt` has **no exit but `archiveApplication`**:

| would-be exit | why it refuses |
|---|---|
| `attest` (either result) | gates on `awaitingBgReview.has`, which returns false the moment `bgClearedAt` is set ([review.ts:221](../../checkin-app/src/lib/membership/review.ts:221), [lifecycle.ts:147](../../checkin-app/src/lib/membership/lifecycle.ts:147)) — `wrong_phase` |
| the reviewer queue / badge | `awaitingBgReview.where` carries `bgClearedAt: null` — the row is not listed and not counted |
| `activate()` | ignores any status but `PENDING_PAYMENT` ([payment.ts:168](../../checkin-app/src/lib/membership/payment.ts:168)) |
| `advanceExternalIfComplete` | ignores any status but `PENDING_EXTERNAL_ACTION` ([external.ts:93](../../checkin-app/src/lib/membership/external.ts:93)) |
| `overrideBlocked reset` — the board's own escape hatch | requires `BLOCKED` **or** `awaitingBgReview.has` ([review.ts:389](../../checkin-app/src/lib/membership/review.ts:389)); the stamp makes both false — `wrong_phase` |

So the naive stamp does not merely hide the application: it puts it beyond the reach of the board
surface built to rescue stuck reviews. Any implementation must move the status in the same write.

**So the split is on the note, not on quorum:**

| condition | why | action |
|---|---|---|
| note still present | BG satisfied; note unread. Stamping drops it out of the queue. | **do not stamp** — `notifyReviewers()` so the queue sees the new evidence |
| note deleted since the hold | nothing remains for a human to read | **clear it** — stamp + converge, same as any other state |

The second row is a real case: leads can delete a note at any time
([household/settings/route.ts:27](../../checkin-app/src/app/api/household/settings/route.ts:27) — an emptied
box writes `intakeNotes: null`) and nothing re-advances the held row when they do. It sits there
with its cause gone. The carryover is a legitimate way out.

#### The note-deleted population

This is where the "a household application cannot sit at `PENDING_BG_REVIEW` without a live intake
note" claim breaks, and the break matters, so it is worth stating exactly.

**True:** a household `INITIAL`/`RENEWAL` cannot *enter* `PENDING_BG_REVIEW` without a live note.
Both household edges demand one at transition time — `advanceExternalIfComplete`'s `holdForNote`
([external.ts:112](../../checkin-app/src/lib/membership/external.ts:112)) and `blockedResetStatus`'s
`!paidAt && intakeNotes?.trim()` arm ([review.ts:448](../../checkin-app/src/lib/membership/review.ts:448)).
The third edge into the state is `PERSON_BG` only.

**False:** that it cannot *sit* there without one. Nothing re-reads the note after the transition,
and a lead can null it at any time from household settings. So `{household process, status =
PENDING_BG_REVIEW, bgClearedAt = null, note gone}` is a reachable resting state — and it is the
one household row at this status the design already says the carryover should clear.

The design's conclusion therefore survives with a smaller footnote than the issue thread implies:
the carryover is a no-op at `PENDING_BG_REVIEW` **for note-held rows**, which is most of them, but
not for all of them. Whether that residue is worth building for is a counting question, not an
argument — see [query 3](#query-3--the-population-the-design-refuses-to-clear).

**Do not stay silent in the first case.** The operator changed the facts under a held application
and should learn it. The merge already owns the mechanism: `analyze` surfaces conflicts and the
POST **400s** until the operator answers ([route.ts:240-250](../../checkin-app/src/app/api/membership-ops/participants/merge/route.ts:240)).
Disclose the held application, ping the reviewers, and audit that a merge made this household
fresh without clearing it.

**Cost of showing the note text.** `intakeNotes` is `@sensitivity:pii` carrying hardship/medical/
family narrative, and the analyze route's `select` excludes it *deliberately*
([analyze/route.ts:27](../../checkin-app/src/app/api/membership-ops/participants/merge/analyze/route.ts:27)).
The route is board/sysadmin-only and is **not** in the security registry (16 registered routes;
merge is not among them), so this needs no boundary PR — but it reverses a documented exclusion
and must be a stated decision, not a drive-by field addition. The cheaper variant discloses only
*that* a held application exists, linking to the review queue where reviewers already read the
note under `everyones:pii`.

**This is the strongest argument for `noteAcknowledgedAt`.** With the two facts separated, this
whole state collapses into the ordinary rule: the carryover stamps BG-satisfied, the queue keys on
note-unacknowledged, and neither silently cancels the other. Every awkward case in this section is
a symptom of the one overloaded field.

### `PENDING_PAYMENT` and `PENDING_BG_CLEARANCE`

First, a code fact that narrows the question. A row is at `PENDING_PAYMENT` with `bgClearedAt`
null only by having passed `advanceExternalIfComplete` with `holdForNote` **false** — which, given
`bgClearedAt` was null, means **there was no note at advance time**. `PENDING_BG_CLEARANCE`
inherits that through `activate()`.

So a note visible on such a household *now* was added afterward (leads can edit it at any time,
[household/settings/route.ts:27](../../checkin-app/src/app/api/household/settings/route.ts:27)) and has
**provably been read by nobody**. "The gate ran and passed" is wrong — the gate ran and found
nothing. There is no adjudicated-note case at these states.

- **Transition-gate reading:** the note has nothing left to gate — dues are fixed, the payment link
  is minted. Freshness alone; carry over.
- **Standing-flag reading:** an unread note on a household the system is about to auto-clear is
  exactly the case the field exists for. Skip the carryover while a note is live; leave the board
  the 2-of-N review.

**Unresolved — board call.** Note the cost asymmetry: these two states are where essentially all
of the fix's value lives ([Reachability](#reachability-correction)), so the conservative reading
does not merely narrow the fix, it comes close to deleting it. That is a legitimate outcome if the
board's answer is that a live note means hands-off — but it should be chosen, not inherited from
whichever predicate got copied.

Note also the inconsistency the conservative reading would create: **nothing blocks the family
from paying right now** with that same unread note live. Blocking only the BG carryover would make
the note gate stricter for the automatic path than for the money path.

### Consequence

There is no single "merge predicate". `householdBgIsFresh` is the settled half; the note clause is
a policy question with a different answer per state. Writing it as one shared predicate — the
issue's advice — is what makes the failure modes above easy to ship by accident, in either
direction.

**The durable fix is a `noteAcknowledgedAt` (or equivalent) on `Household`,** so "a human has seen
this" stops being inferred from row status. Out of scope here; worth its own issue, and it would
collapse both readings into one rule.

**Blocker for the PR:** `householdBgIsFresh` closes over the module `prisma` client. To run inside
the merge's `$transaction` and see the keeper update from step 2, it needs a `db: DbClient`
parameter. Three call sites: [intake.ts:392](../../checkin-app/src/lib/membership/intake.ts:392),
[renewal.ts:191](../../checkin-app/src/lib/membership/renewal.ts:191),
[api/membership-audit/compliance/route.ts:53](../../checkin-app/src/app/api/membership-audit/compliance/route.ts:53).

## The state matrix

Every status the **keeper's household process** can hold with `bgClearedAt = null`, and what the
merge does. Per the section above, no other process is a candidate.

| status | why it's uncleared | note gate | merge action | converges via |
|---|---|---|---|---|
| `INTAKE` | pre-external; the shortcut hasn't been evaluated yet | not yet run | **nothing** | `submitIntake` re-reads it — self-healing |
| `PENDING_RENEWAL` | same, renewal side | not yet run | **nothing** | `beginRenewal` re-reads it — self-healing |
| `PENDING_EXTERNAL_ACTION` | shortcut didn't fire at intake/renewal | **not yet run** | **stamp only, gated on `!note`** | the eventual `markContractSigned`/`markBgConsent` → `advanceExternalIfComplete` |
| `PENDING_BG_REVIEW`, note live | note-held or blocked-reset | **actively holding** | **never clears** (two-reviewer rule) — but **discloses + pings reviewers** | reviewers only |
| `PENDING_BG_REVIEW`, note deleted since the hold | the hold's cause is gone | none left to read | **stamp + converge**, same as any other state ([why](#the-note-deleted-population)) | this carryover |
| `PENDING_PAYMENT` (parallel, `bgConsentAt` set) | review runs alongside payment | **ran, found none — any note here is unread** | **stamp only** — status already correct. Note clause **UNRESOLVED** | a later `activate()` now lands `ACTIVE` instead of `PENDING_BG_CLEARANCE` |
| `PENDING_BG_CLEARANCE` | paid, waiting on the check | **ran, found none — any note here is unread** | **stamp + `ACTIVE`** + flip `OrgMembership.status`. Note clause **UNRESOLVED** | existing `clearBackgroundCheck` edge |
| `BLOCKED` | a reviewer **rejected** | n/a | **nothing, ever** | only `overrideBlocked`, board-only |
| `RENEWAL_PENDING_BG` | dead-but-guarded legacy (the reachability test asserts it unreachable) | n/a | **nothing** | n/a |
| `ACTIVE` / `ARCHIVED` | terminal | n/a | **nothing** | n/a |

The carryover acts on **three** states. The note clause is settled at one
(`PENDING_EXTERNAL_ACTION`, apply it) and **unresolved at the other two** — and those two are
where the value is. Notes on the rows that aren't obvious:

**`PENDING_EXTERNAL_ACTION` is stamp-only on purpose.** `advanceExternalIfComplete`
([external.ts:90](../../checkin-app/src/lib/membership/external.ts:90)) reads the module `prisma` client and
opens its own transaction — it cannot be called from inside the merge's. Stamping alone is
sufficient and safe: the row is already waiting on a contract signature or consent, and the
existing advance path picks the stamp up when that arrives. Calling `advanceExternalIfComplete`
after the merge commits is possible but reintroduces the exact non-atomicity #1396 is about.

**`PENDING_PAYMENT` must not be skipped just because its status doesn't change.** Stamping there
is the whole point: it drops the row out of the reviewer queue
([lifecycle.ts:147](../../checkin-app/src/lib/membership/lifecycle.ts:147)) and pre-decides `activate()`'s
`activating = !!process.bgClearedAt` branch ([payment.ts:208](../../checkin-app/src/lib/membership/payment.ts:208)).

**`PENDING_BG_REVIEW` is a no-op for note-held rows, which mostly deletes the issue's headline
case.** See [the predicate](#the-predicate) for why a live note read there opens a hole rather than
closing one. The practical effect: the state #1396 names is almost the one state the carryover will
not touch. That is the correct outcome — a held row is held *for a human*, and no automatic path
should release it — but it means the fix's value lives essentially in the parallel-track states,
plus however many note-deleted rows [query 1](#query-1--which-process-was-actually-seen-in-production)
turns up.

Whatever the split, the status **must** move with the stamp at this state: a stamped-but-still-
`PENDING_BG_REVIEW` row is unreachable by every path including the board's own reset
([above](#pending_bg_review--bgclearedat-carries-two-facts-and-the-merge-establishes-only-one)).

## Reachability correction

The issue's repro says "an in-flight application sitting at background-check review".
`PENDING_BG_REVIEW` is reachable only three ways — re-derived at `a00331fa` from `TRANSITIONS`
([lifecycle.ts:297/303/319](../../checkin-app/src/lib/membership/lifecycle.ts:297)) and cross-checked
against every site that writes the literal, of which there are exactly three:

| edge | writer | precondition |
|---|---|---|
| `PENDING_EXTERNAL_ACTION → PENDING_BG_REVIEW` | [external.ts:113](../../checkin-app/src/lib/membership/external.ts:113) | `!bgClearedAt && intakeNotes` at advance time |
| `∅ → PENDING_BG_REVIEW` | [personBgTriggers.ts:52](../../checkin-app/src/lib/membership/personBgTriggers.ts:52) | `PERSON_BG` only; no note involved |
| `BLOCKED → PENDING_BG_REVIEW` | [review.ts:445/448](../../checkin-app/src/lib/membership/review.ts:445) | `PERSON_BG`, or household with `!paidAt && intakeNotes` at reset time |

Every one of those is either a `PERSON_BG` (scoped out) or note-held **at the moment of entry**.
Combined with the no-op decision above, **the carryover almost never fires in the state the issue
names** — the exception being the note-deleted residue described
[above](#the-note-deleted-population), which the design does clear.

The states it can help are the parallel-track ones — `PENDING_PAYMENT` and
`PENDING_BG_CLEARANCE` — which the issue doesn't mention, plus `PENDING_EXTERNAL_ACTION`. **The
fix is worth roughly what the issue claims, in entirely different states than it names** — and
only if open question 0 resolves toward the transition-gate reading. Under the standing-flag
reading, a household with a live note gets nothing at any state, and the fix shrinks to
`PENDING_EXTERNAL_ACTION` plus note-free households.

### Latent gap, not in scope

A `PENDING_BG_REVIEW` row whose note is later deleted stays held forever — nothing re-runs
`advanceExternalIfComplete` on a note edit
([household/settings/route.ts:27](../../checkin-app/src/app/api/household/settings/route.ts:27) writes the
note and nothing else). Reviewers still have to act on a hold whose cause is gone. Pre-existing,
unrelated to merge, worth its own issue.

### PERSON_BG is a separate question

Merge re-points `subjectPersonId` to the keeper
([merge/route.ts:374](../../checkin-app/src/app/api/membership-ops/participants/merge/route.ts:374)), so a
`PERSON_BG` at `PENDING_BG_REVIEW` follows the survivor. `householdBgIsFresh` is a *household
leads* predicate — the wrong question for a `PERSON_BG`, which asks about one specific person.

**Correction: the person-scoped predicate this section said did not exist, does.**
`personBgVerdict(person, boundary, threshold)` returns `FRESH` for exactly the question a
`PERSON_BG` asks ([personBgCheck.ts:57](../../checkin-app/src/lib/membership/personBgCheck.ts:57)); it is
pure, takes the person row, and is already the create-time guard inside `openPersonBg`
([personBgTriggers.ts:41](../../checkin-app/src/lib/membership/personBgTriggers.ts:41)). It predates this
document. Together with #1449's guarantee of at most one open `PERSON_BG` per survivor, both
stated obstacles to covering `PERSON_BG` are gone.

What remains is genuinely a different shape of change, and it is small:

- The gap is that `openPersonBg`'s freshness guard runs **only at create time**. Nothing closes an
  open `PERSON_BG` when its subject later becomes fresh — a merge being one way that happens, the
  board recording a check on the person being another. So this is not merge-specific.
- Resolution is not "stamp `bgClearedAt` and converge": a `PERSON_BG` has no membership and no
  payment track. `clearBackgroundCheck`'s `PERSON_BG` branch
  ([review.ts:288-294](../../checkin-app/src/lib/membership/review.ts:288)) stamps the subject and goes
  straight to `ACTIVE`. Reusing it from a merge would re-stamp `lastBackgroundCheck` to `now()`,
  extending the recheck window past the carried date — the same overwrite the household path is
  told to avoid. The right disposal is closer to #1449's archive-with-audit than to a clearance.
- Both the two-reviewer rule and the COI gate apply to it exactly as they do to the household path.

**Recommendation, unchanged in outcome but not in reasoning: scope `PERSON_BG` out of this
change** — because it is a different disposal with its own edge and its own audit shape, not
because the predicate is missing. State that in the PR. **But this recommendation is conditional
on [query 1](#query-1--which-process-was-actually-seen-in-production):** if the row seen in
production was a `PERSON_BG`, scoping it out means shipping a fix that does not address the report,
and the sequencing should be inverted.

## Conflict of interest

**The merge route has no COI check.** Today that is defensible: merging duplicate person records
is data hygiene, not a membership decision.

The carryover changes that. It makes the merge a path that advances a household's membership
state — and at `PENDING_BG_CLEARANCE`, all the way to `ACTIVE`. Every other path that touches
background-check clearance is COI-gated:

| path | gate |
|---|---|
| `attest` | `sharesHousehold(reviewer, applicant)` → refuse ([review.ts:223](../../checkin-app/src/lib/membership/review.ts:223)) |
| `overrideBlocked` | `hasHouseholdConflict(actor, applicant)` → refuse, *"No role bypasses this"* ([review.ts:376](../../checkin-app/src/lib/membership/review.ts:376)) |
| `certifyPaymentPlan` / `grantRenewalPayment` | COI check on every actor, sysadmin included (#1391) |
| **merge (proposed carryover)** | **none** |

Without a gate, a board member merges a duplicate carrying a fresh `lastBackgroundCheck` into
their own household's record and their own stalled application converges — no second reviewer, no
override, no audit that reads as a clearance. It is `overrideBlocked approve` with the safety rail
removed and a data-cleanup label on it.

**The carryover must be COI-gated, reusing `hasHouseholdConflict`** — matching #1391's settled
rule that every actor including sysadmin is held to it. Two shapes to choose between:

1. **Skip the carryover** when the actor conflicts; the merge itself still proceeds. Data hygiene
   is unaffected, the membership side-effect is withheld, and the household keeps its 2-of-N.
2. **Refuse the whole merge.** Simpler to reason about, but blocks legitimate deduplication for a
   reason unrelated to the duplicate.

Shape 1 is the better default — it withholds exactly the privileged effect. Either way this is
**not optional**, and it is the one item here that is a correctness requirement rather than a
policy preference.

## Provenance

**Open — see [question 1](#open-questions).**

Attestations are keyed `@@unique([processId, reviewerId])` and mean *"reviewer X attested on THIS
application."* Copying them onto the survivor's process would fabricate two board members'
signatures on an application neither saw, and a board reset
([review.ts:395](../../checkin-app/src/lib/membership/review.ts:395)) deletes by `processId` — copies would
either be destroyed by an unrelated reset or survive the withdrawal of the original approval.
**Not copying attestations is settled.**

What is not settled is whether the *link* to the approvers survives.

| path | stamps `bgClearedAt` from | approvers reachable from the stamped household? |
|---|---|---|
| `clearBackgroundCheck` | this process's own 2 attestations | yes — same row |
| intake shortcut | a prior check in the **same** household | yes — same household's process history |
| renewal shortcut | a prior check in the **same** household | yes — same household's process history |
| **merge (proposed)** | a check on the **tombstone's** household | **no** |

`clearBackgroundCheck` stamps `lastBackgroundCheck` on every lead of *its* household
([review.ts:305](../../checkin-app/src/lib/membership/review.ts:305)), and merge deliberately leaves
`householdId` on the old household
([merge/route.ts:420](../../checkin-app/src/app/api/membership-ops/participants/merge/route.ts:420)). So the
survivor's household history does not contain the process that produced the date. Merge is the
first stamp that breaks the chain to the humans who approved.

Three options, none costed yet:

1. **Audit blob only.** Record `{ via: "merge", sourcePersonId, sourceCheckDate }` in the audit
   row's `newData`. No schema change. An auditor can follow person → household → process by hand.
2. **Resolve and record the originating `processId`.** Requires matching `bgClearedAt` against the
   tombstone's household processes — fuzzy, since the date is stamped on the Person, not linked.
3. **Refuse the carryover when provenance can't be established** and leave the board a redundant
   2-of-N review. Costs the thing the issue is trying to save.

Option 1 is the cheap default. **Deferred to @thpr** — this is the piece flagged as needing
thought, and the choice is a board-policy call about what "cleared" has to be able to prove, not
an implementation preference.

Whichever is chosen, the audit actor should be **the merging board member**, not `SYSTEM_ACTOR`:
they caused the state change, and a system actor would hide who.

## Emails

**Open — see [question 2](#open-questions).**

The precedent is split, and merge is the first event that lands on the wrong side of the split.

| path | stamps | emails fired |
|---|---|---|
| `clearBackgroundCheck` → `ACTIVE` | yes | `sendCongrats` + `openPersonBgForNewMember` (INITIAL only) — [review.ts:250](../../checkin-app/src/lib/membership/review.ts:250) |
| `clearBackgroundCheck` → `PENDING_PAYMENT` | yes | `notifyPaymentOpen` — [review.ts:259](../../checkin-app/src/lib/membership/review.ts:259) |
| intake shortcut | yes | **none** |
| renewal shortcut | yes | **none** |
| merge (proposed) | yes | ??? |

The shortcut paths send nothing because they stamp at a point where nothing user-visible has
resolved — the applicant still has to sign and pay. Merge is shortcut-shaped, but from
`PENDING_BG_CLEARANCE` it reaches `ACTIVE`, which **no shortcut path can**. A household can go
from "waiting" to "member" because a board member deduplicated two records.

Only one state can send anything, since `PENDING_BG_REVIEW` is a no-op:

- **`ACTIVE` (from `PENDING_BG_CLEARANCE`).** Silence means the family is a member and never told.
  `sendCongrats` says "Welcome to the Treehouse" — correct content, surprising trigger.
  `openPersonBgForNewMember` (Trigger C) is *not* optional if the row is `INITIAL`: skipping it
  leaves program-attached adults without their `PERSON_BG` processes, a compliance gap, not a
  courtesy.
- **`notifyPaymentOpen` is unreachable.** Its only trigger would have been
  `PENDING_BG_REVIEW → PENDING_PAYMENT`, which the carryover no longer performs.
- **Stamp-only rows.** Nothing to announce. No email.

**Recommendation:** fire `sendCongrats` + Trigger C, matching `clearBackgroundCheck` exactly, and post-transaction
like every other side effect in this module ([payment.ts:233](../../checkin-app/src/lib/membership/payment.ts:233)
— "a slow/failed send must not roll back the write"). The alternative — a silent activation — is
worse than a surprising email. **Confirm with @thpr before building**; a dedupe cleanup that mails
families is the kind of thing that should not be discovered in production.

## Idempotency

- **Repeat merge** is already blocked: the tombstone CAS
  ([merge/route.ts:267-282](../../checkin-app/src/app/api/membership-ops/participants/merge/route.ts:267)) throws
  `AlreadyMergedError` on the second attempt, so the carryover cannot run twice for one pair.
- **Merge racing a reviewer's 2nd approval** is guarded upstream: `attest` gates on
  `awaitingBgReview.has`, which requires `bgClearedAt = null`. Whichever lands first excludes the
  other. No double congrats.
- **`applyVolunteerStatus`** is sticky and additive — never clears — so calling it from the merge
  is idempotent by construction. It **must** be called: the fresh-check shortcut exists precisely
  because `clearBackgroundCheck` never runs that cycle, and without it a pre-designated volunteer
  household gets non-volunteer dues (#874). Same hole applies here.
- **One atomic write** (`docs/conventions.md`) — status + `bgClearedAt` + `stageEnteredAt` in a
  single `updateMany`, never a stamp-then-flip pair.

## Lifecycle machine impact

Once `PENDING_BG_REVIEW` is a no-op, exactly **one** new edge remains — a new *event* on an
existing edge, not a new arrow:

```
PENDING_BG_CLEARANCE → ACTIVE   event: mergeBgCarryover   actor: board/sysadmin
```

The other two acting states (`PENDING_EXTERNAL_ACTION`, `PENDING_PAYMENT`) are stamp-only: they
change `bgClearedAt`, not `status`, so they declare no edge at all.

This is smaller than it first looked — the lifecycle-machine surface is **not** what makes this
doc-scale. The predicate analysis above is.

Per [`docs/ops/lifecycle-machines.md`](../ops/lifecycle-machines.md):
- The CAS guard's from-state clause comes from `fromWhere(edge)`, not a hand-written `status:`.
  The guard↔`TRANSITIONS` parity test enforces it.
- Regenerate `docs/generated/lifecycle/membership.md`; the artifacts-drift test fails
  otherwise.
- No new status, so `classify`'s exhaustive switch and `INVARIANTS` are untouched. The
  `active-is-bg-cleared` invariant is satisfied by construction (the stamp is in the same write).

## Shape

Extract from `clearBackgroundCheck` ([review.ts:296-317](../../checkin-app/src/lib/membership/review.ts:296))
everything except the household-lead date stamp — that stamp is what the merge has *already* done
by moving `lastBackgroundCheck`, and re-running it would overwrite the carried date with `now()`,
silently extending the recheck window past what any human approved.

The extracted block: per-state predicate → stamp `bgClearedAt` → converge status on `paidAt` →
flip `OrgMembership.status` when paid → `applyVolunteerStatus` → audit. Called from inside the
merge's existing `$transaction`, after step 2's keeper update, and **behind the COI gate**
([above](#conflict-of-interest)) — which runs pre-transaction, like the merge's existing household-lead and
stranded-identity guards.

Side effects (emails, Trigger C, the `PENDING_BG_REVIEW` reviewer ping) return to the caller and
fire **after** the transaction commits, matching `clearBackgroundCheck`'s caller and `activate()`.

The `analyze` route gains the held-application disclosure ([above](#the-predicate)); it is a
read-only GET and needs no transaction.

## Out of scope

- **Retraction.** Merging a sole-member household lead who held the only fresh check live-empties
  that household — the tombstone CAS clears `isHouseholdLead`
  ([merge/route.ts:277](../../checkin-app/src/app/api/membership-ops/participants/merge/route.ts:277)). This is
  live behaviour today, and it already surfaces through
  [compliance/route.ts:53](../../checkin-app/src/app/api/membership-audit/compliance/route.ts:53), which
  re-runs the predicate per household at read time. **Automatic carryover advances only, never
  retracts** — withdrawing a clearance is a board action.
- **Program-enrollment paths** keyed off the same freshness.
- **PERSON_BG** — needs a person-scoped predicate that doesn't exist (see above).

## Testing

- **Integration** (`merge/route.integration.test.ts`) — one case per acting row of the state
  matrix, plus the note-gate cases, which are the ones a naive "reuse the full predicate"
  implementation gets wrong:
  - `PENDING_EXTERNAL_ACTION` + note ⇒ **no stamp** (guards the #907 bypass).
  - `PENDING_PAYMENT` + note ⇒ asserts whichever way open question 0 resolves. Write this test
    *last*; it is the executable form of the board's answer.
  - `PENDING_BG_REVIEW`, note deleted after the hold ⇒ **still uncleared** (pins the two-reviewer
    rule), and reviewers pinged.
  - Tombstone already a live lead of the survivor's household ⇒ no change; `BLOCKED` untouched.
- **COI** — actor in the survivor's household ⇒ merge succeeds, carryover withheld, process
  status unchanged. Sysadmin included (#1391). This one is a security assertion, not a behaviour
  assertion; it belongs in the suite even if every other case is deferred.
- **Unit** — `applyVolunteerStatus` fires on the merge path (the #874 hole).
- **Lifecycle** — `fromWhere` parity + regenerated artifacts.
- **Full `test:ci` and integration**, not just the merge suite: the extraction cuts into
  `clearBackgroundCheck`, a money and state-machine path.

## Queries

Three of the questions below cannot be settled by reading code — they are facts about the
production database. These are the queries that settle them. **All read-only** (no `INSERT`,
`UPDATE`, `DELETE`, `CREATE`); each is self-contained and pasteable into a `psql` session as-is.

Two shared conventions:

- **Freshness is recomputed in SQL, not read off a column.** There is no stored "fresh" flag —
  `householdBgIsFresh` derives it at read time from `BoardSettings`. The `bg_policy` CTE below
  mirrors `nextBoundary` + `monthsBefore` ([renewal.ts:40-50](../../checkin-app/src/lib/membership/renewal.ts:40)):
  the boundary is this UTC year's month/day occurrence, rolled forward a year if it has passed;
  the threshold is that minus `bgRecheckMonths`. Two caveats, both stated rather than hidden:
  `bgRecheckMonths = 0` means *nothing is fresh* (the CTE returns no rows, so every query below
  correctly returns nothing), and Postgres `- interval 'N months'` clamps end-of-month where JS
  `setUTCMonth` rolls over. For a boundary on the 1st — the real configured value — they agree.
- **There is no merge table.** A merge leaves two traces: `Person.mergedIntoId` on the tombstone,
  and one `AuditLog` row (`tableName = 'Person'`, `action = 'DELETE'`, `affectedEntityId` = keeper,
  `secondaryAffectedEntity` = tombstone, `oldData` = the tombstone's full pre-image including its
  `lastBackgroundCheck`). The audit row is what carries the timestamp and the carried-over date, so
  the queries key on it.

Every date column involved is `timestamp without time zone` holding UTC, so the queries stay in
that space throughout — `now() AT TIME ZONE 'UTC'`, `make_timestamp`, and `::timestamp` on the
audit JSON (which Prisma serialises as ISO-8601 UTC). Mixing in `timestamptz` silently shifts
results by the session's `TimeZone` and was wrong in an earlier draft of these queries; don't
reintroduce it.

**These were run.** Not against production — against a throwaway Postgres 16 with the repo's
migrations applied and hand-built fixtures covering each classification the "how to read it"
tables depend on: a merge-carried fresh lead, a note-held row, a note-deleted row, a `PERSON_BG` on
a survivor, a stale household (must not appear), and a household whose only fresh check sits on a
tombstone lead (must not count as fresh). Each landed in the bucket claimed below. That validates
the SQL and the classification logic; it says nothing about what production contains.

```sql
-- Shared preamble used by every query below. Returns ZERO rows when the board has
-- not configured a recheck window — which is the correct answer, not a bug.
-- (Paste this CTE at the top of each query; it is repeated inline below so each
-- block stands alone.)
WITH bg_policy AS (
    SELECT
        s."bgRecheckMonths" AS recheck_months,
        CASE WHEN cand < (now() AT TIME ZONE 'UTC') THEN cand + interval '1 year' ELSE cand END AS boundary
    FROM "BoardSettings" s
    CROSS JOIN LATERAL (
        SELECT make_timestamp(
            extract(year  from (now() AT TIME ZONE 'UTC'))::int,
            extract(month from s."orgMembershipYearBoundary")::int,
            extract(day   from s."orgMembershipYearBoundary")::int,
            0, 0, 0) AS cand
    ) c
    WHERE s.id = 1
      AND s."orgMembershipYearBoundary" IS NOT NULL
      AND s."bgRecheckMonths" > 0
)
SELECT boundary, recheck_months, boundary - make_interval(months => recheck_months) AS threshold
FROM bg_policy;
```

### Query 1 — which process was actually seen in production?

**The question.** The report describes an application stuck at background-check review after a
merge. Was that a household `INITIAL`/`RENEWAL`, or a `PERSON_BG`? The design scopes `PERSON_BG`
out; if that is what was seen, the design does not cover the report.

```sql
-- Every process at PENDING_BG_REVIEW that is attached to a merge survivor,
-- with the two facts that decide the disposition: its kind, and whether its
-- household still carries a live intake note.
WITH merges AS (
    SELECT a.id                        AS audit_id,
           a."timestamp"               AS merged_at,
           a."affectedEntityId"        AS keeper_id,
           a."secondaryAffectedEntity" AS tombstone_id,
           a."oldData"->>'lastBackgroundCheck' AS tombstone_bg_at_merge
    FROM "AuditLog" a
    WHERE a."tableName" = 'Person'
      AND a.action = 'DELETE'
      AND a."secondaryAffectedEntity" IS NOT NULL
)
SELECT m.merged_at,
       m.keeper_id,
       m.tombstone_id,
       m.tombstone_bg_at_merge,
       keeper."lastBackgroundCheck" AS keeper_bg_now,
       p.id     AS process_id,
       p.kind,
       p.status,
       p."stageEnteredAt",
       p."bgClearedAt",
       p."paidAt",
       CASE WHEN p.kind = 'PERSON_BG' THEN NULL
            ELSE (h."intakeNotes" IS NOT NULL AND btrim(h."intakeNotes") <> '')
       END AS household_note_live,
       (SELECT count(*) FROM "BackgroundCheckAttestation" ba WHERE ba."processId" = p.id) AS attestations
FROM merges m
JOIN "Person" keeper           ON keeper.id = m.keeper_id
LEFT JOIN "Household" h        ON h.id = keeper."householdId"
LEFT JOIN "OrgMembership" om   ON om."householdId" = keeper."householdId"
JOIN "OrgMembershipProcess" p
       ON  p."subjectPersonId" = m.keeper_id          -- the PERSON_BG that follows the survivor
       OR  p."orgMembershipId" = om.id                -- the survivor household's application
WHERE p.status = 'PENDING_BG_REVIEW'
ORDER BY m.merged_at DESC;
```

**How to read it.**

| result | what it means |
|---|---|
| rows with `kind = 'PERSON_BG'` | **The designed fix does not address the reported bug.** A `PERSON_BG` reaches this state with no note at all, has its `subjectPersonId` re-pointed by the merge, and is explicitly scoped out. Invert the sequencing: build the `PERSON_BG` disposal ([above](#person_bg-is-a-separate-question)) first, and treat the household carryover as the separate improvement it is. |
| rows with `kind IN ('INITIAL','RENEWAL')` and `household_note_live = true` | The design's answer applies as written: **disclose and ping the reviewers, never auto-clear.** The fix delivers nothing for these rows, and open question 0 does not change that. |
| rows with `kind IN ('INITIAL','RENEWAL')` and `household_note_live = false` | The [note-deleted residue](#the-note-deleted-population). These *are* clearable under the design. Their count is the fix's value at the state the issue names. |
| no rows at all | Whatever was seen has since moved or been archived. Fall back to the historical variant: replace the final `WHERE p.status = 'PENDING_BG_REVIEW'` with `WHERE p.status = 'PENDING_BG_REVIEW' OR EXISTS (SELECT 1 FROM "AuditLog" pa WHERE pa."tableName" = 'OrgMembershipProcess' AND pa."affectedEntityId" = p.id AND pa."timestamp" >= m.merged_at AND (pa."oldData"->>'status' = 'PENDING_BG_REVIEW' OR pa."newData"->>'status' = 'PENDING_BG_REVIEW'))`, which also finds processes that *passed through* the state after their merge. |

This is the query that decides whether the design is aimed at the right thing. Run it first.

### Query 2 — how many rows disagree today?

**The question.** How many live applications are in the exact state #1396 describes: the household
holds a valid background check, and the process does not know it. If the answer is a handful, doing
it by hand costs less than the fix.

**What "disagree" means, spelled out** — this is the whole content of the query, so it is not
buried in a join:

1. the process is a **household** process (`kind IN ('INITIAL','RENEWAL')`),
2. it is **in-flight and uncleared** — `bgClearedAt IS NULL` and status in the four non-terminal
   BG-relevant states,
3. its household **is** BG-fresh — some live (`mergedIntoId IS NULL`) household lead has
   `lastBackgroundCheck >= threshold`.

(1)+(2)+(3) together are the disagreement: `householdBgIsFresh` says yes, `bgClearedAt` says no.
The `via_merge` column then splits out the ones this design would fix from pre-existing drift.

```sql
WITH bg_policy AS (
    SELECT s."bgRecheckMonths" AS recheck_months,
           CASE WHEN cand < (now() AT TIME ZONE 'UTC') THEN cand + interval '1 year' ELSE cand END AS boundary
    FROM "BoardSettings" s
    CROSS JOIN LATERAL (
        SELECT make_timestamp(
            extract(year  from (now() AT TIME ZONE 'UTC'))::int,
            extract(month from s."orgMembershipYearBoundary")::int,
            extract(day   from s."orgMembershipYearBoundary")::int,
            0, 0, 0) AS cand) c
    WHERE s.id = 1 AND s."orgMembershipYearBoundary" IS NOT NULL AND s."bgRecheckMonths" > 0
),
thresh AS (
    SELECT boundary - make_interval(months => recheck_months) AS threshold FROM bg_policy
),
-- A person whose current lastBackgroundCheck is the value a merge handed them:
-- the merge copies the tombstone's date verbatim, so equality to the microsecond
-- identifies the carry. Same exact-join reasoning as #1470's blanket-stamp worklist.
merge_carried AS (
    SELECT DISTINCT a."affectedEntityId" AS person_id
    FROM "AuditLog" a
    JOIN "Person" k ON k.id = a."affectedEntityId"
    WHERE a."tableName" = 'Person' AND a.action = 'DELETE'
      AND a."secondaryAffectedEntity" IS NOT NULL
      AND a."oldData"->>'lastBackgroundCheck' IS NOT NULL
      AND k."lastBackgroundCheck" = (a."oldData"->>'lastBackgroundCheck')::timestamp
)
SELECT p.status,
       p.kind,
       (h."intakeNotes" IS NOT NULL AND btrim(h."intakeNotes") <> '') AS note_live,
       EXISTS (SELECT 1 FROM "Person" lead
                WHERE lead."householdId" = om."householdId"
                  AND lead."isHouseholdLead"
                  AND lead."mergedIntoId" IS NULL
                  AND lead.id IN (SELECT person_id FROM merge_carried)) AS via_merge,
       count(*) AS processes
FROM "OrgMembershipProcess" p
JOIN "OrgMembership" om ON om.id = p."orgMembershipId"
JOIN "Household"     h  ON h.id  = om."householdId"
CROSS JOIN thresh t
WHERE p.kind IN ('INITIAL','RENEWAL')
  AND p."bgClearedAt" IS NULL
  AND p.status IN ('PENDING_EXTERNAL_ACTION','PENDING_BG_REVIEW','PENDING_PAYMENT','PENDING_BG_CLEARANCE')
  AND EXISTS (
        SELECT 1 FROM "Person" lead
         WHERE lead."householdId" = om."householdId"
           AND lead."isHouseholdLead"
           AND lead."mergedIntoId" IS NULL          -- LIVE_PERSON
           AND lead."lastBackgroundCheck" >= t.threshold
      )
GROUP BY 1, 2, 3, 4
ORDER BY 1, 2, 3, 4;
```

**How to read it.**

- **Sum of `processes` where `via_merge = true`** is the population #1396 actually created. Under
  ~5, fix the rows by hand (a board force-approve per row) and close the issue; the COI gap
  ([above](#conflict-of-interest)) is then the only thing in this document still worth building,
  and it is worth building on its own.
- **Rows where `via_merge = false`** are households that drifted some other way — the date moved
  without the process noticing for a reason that is not a merge. A non-trivial count here means
  the underlying problem is broader than merge, and a merge-local fix is the wrong shape.
- **The `status` split is the value split.** `PENDING_PAYMENT` + `PENDING_BG_CLEARANCE` are where
  the carryover pays off; `PENDING_EXTERNAL_ACTION` is stamp-only; `PENDING_BG_REVIEW` with
  `note_live = true` is refused by design and should be read as zero value.
- **`note_live = true` at `PENDING_PAYMENT` / `PENDING_BG_CLEARANCE`** is the exact population open
  question 0 decides the fate of. Its size is the cost of the conservative reading.

### Query 3 — the population the design refuses to clear

**The question.** Open question 0 asks what an intake note obliges once payment has opened. That is
abstract until you know how many families are in it — and every one of them is provably a note
**nobody has read** ([above](#pending_payment-and-pending_bg_clearance)).

```sql
SELECT p.status,
       p.kind,
       p."paidAt" IS NOT NULL AS paid,
       count(*)                          AS processes,
       min(p."stageEnteredAt")           AS oldest_in_state,
       max(p."stageEnteredAt")           AS newest_in_state
FROM "OrgMembershipProcess" p
JOIN "OrgMembership" om ON om.id = p."orgMembershipId"
JOIN "Household"     h  ON h.id  = om."householdId"
WHERE p.kind IN ('INITIAL','RENEWAL')
  AND p."bgClearedAt" IS NULL
  AND p.status IN ('PENDING_EXTERNAL_ACTION','PENDING_BG_REVIEW','PENDING_PAYMENT','PENDING_BG_CLEARANCE')
  AND h."intakeNotes" IS NOT NULL
  AND btrim(h."intakeNotes") <> ''
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;
```

**How to read it.**

- **`PENDING_PAYMENT` / `PENDING_BG_CLEARANCE` rows**: these notes were added *after* the gate ran
  and found nothing, so they have reached no human. A large count argues for the standing-flag
  reading (a human should touch these before anything automatic) — and against the carryover, since
  those are the two states holding its value. A count of zero makes open question 0 moot in
  practice and the transition-gate reading free to adopt.
- **`PENDING_BG_REVIEW` rows**: the population the design deliberately leaves to the reviewers. Read
  alongside `oldest_in_state` — a note-held row that has been sitting for months is a reviewer-queue
  throughput problem, not a carryover problem, and #1396 will not fix it.
- **`PENDING_EXTERNAL_ACTION` rows**: waiting on a signature or consent. The note clause is settled
  here (apply it), so these are informational only.

Deliberately **not** returned: `intakeNotes` itself. It is `@sensitivity:pii` carrying
hardship/medical/family narrative, and counting does not require reading it.

## Open questions

Ordered by how much they change the fix. **Question 0 is now gated on
[query 1](#query-1--which-process-was-actually-seen-in-production)** — if the production row was a
`PERSON_BG`, none of the note questions bear on the reported bug at all.

0. **What does an intake note mean?** ([above](#the-predicate)) — a gate on the pre-payment review
   (what the code implements), or a standing "a human touches this household before anything
   automatic" flag. Decides whether the carryover fires at `PENDING_PAYMENT` /
   `PENDING_BG_CLEARANCE`, which is nearly the whole fix. Any note live at those states is
   provably unread. **No recommendation — this is the board's to answer.** Follow-on either way:
   a `noteAcknowledgedAt` field would make the question answerable in code instead of by policy.
1. **Provenance** ([above](#provenance)) — audit blob, resolved `processId`, or refuse the
   carryover.
2. **Emails** ([above](#emails)) — fire `sendCongrats` + Trigger C on the one activating state, or stay
   silent. Recommendation: fire them.
3. **`PENDING_EXTERNAL_ACTION`** — stamp-only (recommended, atomic) or stamp-then-call
   `advanceExternalIfComplete` post-commit (moves further, reintroduces the #1396 non-atomicity).

Questions 0–2 are board-policy calls, not implementation preferences; question 3 is an engineering
choice with a stated recommendation.

### Status of the questions after re-grounding

| # | status |
|---|---|
| 0 — what an intake note means | **open, and now sized.** [Query 3](#query-3--the-population-the-design-refuses-to-clear) counts the population it governs; [query 2](#query-2--how-many-rows-disagree-today) prices the conservative reading. Still the board's to answer — the queries make it answerable, not answered. |
| 1 — provenance | **open.** Unchanged by anything on `main`. Note that #1470 will add a `subjectPersonId` to `BackgroundCheckAttestation`, which does *not* solve this: the merge stamps nobody, so there is still no attestation to name. |
| 2 — emails | **open**, and narrower than written. It bears only on `PENDING_BG_CLEARANCE → ACTIVE`; if [query 2](#query-2--how-many-rows-disagree-today) returns no rows at that status, it can be decided later without blocking a PR. |
| 3 — `PENDING_EXTERNAL_ACTION` disposal | **open**, recommendation unchanged (stamp-only). |
| ~~"pick which duplicate `PERSON_BG` to clear"~~ | **dead** — #1449 guarantees at most one. |
| ~~"a person-scoped predicate must be built first"~~ | **dead** — `personBgVerdict` already exists. |

**A question this document did not previously ask, and should:** if
[query 1](#query-1--which-process-was-actually-seen-in-production) says the production row was a
`PERSON_BG`, is the household carryover still worth building at all, or does the value collapse to
the COI gate plus a `PERSON_BG` disposal? The COI gap stands on its own merits either way — it is a
live privilege-escalation path in a shipped route, independent of whether any carryover is ever
built.

## Appendix — why this is a design, and what scoping found

### Why not a ~100-line patch

The issue's suggested shape — extract `clearBackgroundCheck`'s household block and call it inside
the merge transaction — is right, and it really is about that size. Four things sit underneath it
that a PR description cannot hold.

**A merge has two sides, and the issue reasons about one.** Both people can sit in households with
in-flight processes, and both can hold an open `PERSON_BG`. That cross product does collapse — to
"the keeper's household process, always" — but only via a pre-transaction lead guard nobody would
think to look for, and the collapse is the *result* of the analysis rather than a safe starting
assumption. See [Two sides, not one](#two-sides-not-one).

**The note clause is a policy question the code cannot answer.** Eight non-terminal statuses can
carry an uncleared background check; the carryover acts on three. Whether the note clause applies
at each depends on what the board *means* by a note, and nothing in the schema records whether a
human has ever read one. The two readings disagree at exactly the two states holding the fix's
value. The issue's "reuse the full predicate" advice silently picks one, and picks it wrong at the
state it names. See [The predicate](#the-predicate).

**Provenance breaks in a way it does not for intake or renewal.** Those reuse a prior check from
the *same* household, so the approving reviewers stay one query away. A merge pulls a date from the
tombstone's household, which the survivor's history does not contain. See
[Provenance](#provenance).

**It turns an ungated route into a privileged one.** See rule 3 above and
[Conflict of interest](#conflict-of-interest).

One thing that looked like a driver and was not: the declared lifecycle machine. The analysis
reduces to a single new edge. Recorded because the first read suggested otherwise.

### Live bugs found while scoping

None are introduced by this design; none are dependencies. Each is tracked separately.

| Finding | Severity | Status at `a00331fa` |
|---|---|---|
| The merge never compares the two households' membership states, so a paid membership can be stranded on a household with no live members, and a denied household can be escaped by merging out of it | **More serious than #1396** | live; [#1451](https://github.com/innovationtreehouse/checkin/pull/1451) open |
| `LIVE_PERSON` is applied inconsistently, so a household left holding only merged-away members becomes a permanent unactionable board to-do and reaches the keyholder emergency sheet | Moderate | live; [#1450](https://github.com/innovationtreehouse/checkin/pull/1450) open |
| The merge's lead guard counts merged-away records, spuriously refusing valid merges | Moderate | **fixed**, [#1448](https://github.com/innovationtreehouse/checkin/pull/1448) |
| A merge can leave one person with two concurrent `PERSON_BG` reviews | Moderate | **fixed**, [#1449](https://github.com/innovationtreehouse/checkin/pull/1449) |

### Related work

- [#1260](https://github.com/innovationtreehouse/checkin/issues/1260) per-adult background-check
  subjects — **shipped** in [#1470](https://github.com/innovationtreehouse/checkin/pull/1470); the
  rules it established are in `docs/rules/membership.md` § background checks. **That slice has
  landed, so rebase onto it.** Both rewrite the same household clearance branch
  ([review.ts:296-317](../../checkin-app/src/lib/membership/review.ts:296)), so a textual conflict is
  certain; rebase this onto it. They compose semantically — that design makes clearance stamp
  named subjects, while this carryover deliberately stamps nobody, reusing an existing date rather
  than minting a new one. Its *Merge is an ongoing source* section is the other half of
  [Provenance](#provenance). Two concrete couplings re-checked at `a00331fa`: #1470 makes naming a
  subject **mandatory** on the household path (an unnamed approve is a 400), which this design must
  not accidentally re-open a hole in — the carryover names nobody *and stamps no `Person` row*, so
  it does not; and #1470's compliance route grows a `mergeInheritedBgChecks` list that exists
  because #1396 is open, and should be removed when it closes.
- Merge spin-offs from this document's scoping: [#1448](https://github.com/innovationtreehouse/checkin/pull/1448)
  and [#1449](https://github.com/innovationtreehouse/checkin/pull/1449) **merged**;
  [#1450](https://github.com/innovationtreehouse/checkin/pull/1450) and
  [#1451](https://github.com/innovationtreehouse/checkin/pull/1451) **open**. None are dependencies
  of this design, and none were made one by landing.
- [#1429](https://github.com/innovationtreehouse/checkin/issues/1429) volunteer-onset trigger —
  independent; no interaction with the merge path.
