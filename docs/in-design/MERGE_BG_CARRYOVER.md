# Merge-time background-check carryover

Issue: [#1396](https://github.com/innovationtreehouse/checkin/issues/1396)
· Scope, related work, and why this is a design rather than a patch in the
[appendix](#appendix--why-this-is-a-design-and-what-scoping-found).

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
| **Where it applies** | Three application states, none of them the one the issue names — see [state matrix](#the-state-matrix). |
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
   ([route.ts:93](../../checkin-app/src/app/api/membership-ops/participants/merge/route.ts:93));
2. the tombstone's `isHouseholdLead` → `false`, plus `mergedIntoId` set, which drops it out of
   `LIVE_PERSON` ([route.ts:215](../../checkin-app/src/app/api/membership-ops/participants/merge/route.ts:215)).

**And a pre-tx guard bounds the second one.** The merge refuses outright when the tombstone is a
lead of a household that still has other members
([route.ts:157](../../checkin-app/src/app/api/membership-ops/participants/merge/route.ts:157)):

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

**1. Orphaned process on a live-emptied household — auto-archive is the right answer.** Tombstone
was the household's only live member (a sole-member lead, or equally a sole-member non-lead, which
the guard never inspects). Post-merge the household holds a live in-flight process and no live
member — possibly with `bgClearedAt` already stamped from a check that has now walked out.

**"Empty" is imprecise.** The merge does not move `householdId`
([route.ts:355](../../checkin-app/src/app/api/membership-ops/participants/merge/route.ts:355)), so the
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
- increments **two** nav to-do badges ([todo-counts/route.ts:396](../../checkin-app/src/app/api/nav/todo-counts/route.ts:396)).

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

**3. Duplicate `PERSON_BG` — a live bug, independent of #1396.** Both sides can hold an open
`PERSON_BG`. The merge re-points blindly:

```ts
await tx.orgMembershipProcess.updateMany({ where: { subjectPersonId: mergeId }, data: { subjectPersonId: keepId } });
```

There is **no dedupe and no constraint** behind it: `personBgTriggers` carefully checks for an
existing open row before creating one
([personBgTriggers.ts:56](../../checkin-app/src/lib/membership/personBgTriggers.ts:56)), and the two partial
unique indexes are on `orgMembershipId` only — neither covers `subjectPersonId`. So a merge can
leave **one human with two concurrent 2-of-N reviews**, each needing its own attestations. Worth
its own issue; it is also why [PERSON_BG](#person_bg-is-a-separate-question) stays scoped out here
— the carryover would have to pick which duplicate to clear.

**4. The lead guard counts tombstones — another live bug.** `householdOthersCount` is computed
without a `LIVE_PERSON` filter
([route.ts:156](../../checkin-app/src/app/api/membership-ops/participants/merge/route.ts:156)):

```ts
const householdOthersCount = mergeParticipant.household?.householdMembers.filter(p => p.id !== mergeId).length || 0;
```

A household whose only other "member" is a previously-merged tombstone therefore reports
`householdOthersCount === 1`, and merging its lead is refused with a spurious 400. The guard's
intent is *live* members — every other freshness read applies `LIVE_PERSON`. Independent of #1396;
worth its own fix.

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
| [intake.ts:390](../../checkin-app/src/lib/membership/intake.ts:390) | `INTAKE → PENDING_EXTERNAL_ACTION` | don't stamp `bgClearedAt` |
| [renewal.ts:192](../../checkin-app/src/lib/membership/renewal.ts:192) | `PENDING_RENEWAL → PENDING_EXTERNAL_ACTION` | don't stamp |
| [external.ts:112](../../checkin-app/src/lib/membership/external.ts:112) | `PENDING_EXTERNAL_ACTION → {PENDING_PAYMENT ∣ PENDING_BG_REVIEW}` | hold at `PENDING_BG_REVIEW` |
| [review.ts:448](../../checkin-app/src/lib/membership/review.ts:448) | `BLOCKED → reset target` | resume at `PENDING_BG_REVIEW` |

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
([schema.prisma:266-274](../../checkin-app/prisma/schema.prisma:266)). It is written to be read by humans.

The two readings agree at three states and disagree at the two that carry the fix's entire value.
Below, each state is answered under both.

### `PENDING_EXTERNAL_ACTION` — the note clause is load-bearing

`holdForNote = !process.bgClearedAt && !!intakeNotes?.trim()`. A merge stamp flips that to false,
and the row advances straight to `PENDING_PAYMENT`, skipping the review #907 exists to force.

**This is the only state where the merge can break the gate.** Apply `!note && fresh` here.

### `PENDING_BG_REVIEW` — `bgClearedAt` carries two facts, and the merge establishes only one

**The quorum objection does not apply here.** It is tempting to reach for `overrideBlocked`'s rule
— *"force-clearing a review still open to its second reviewer is what the two-reviewer rule
forbids"* ([review.ts:361](../../checkin-app/src/lib/membership/review.ts:361)) — since a `PENDING_BG_REVIEW`
row is exactly that. It is the wrong analogy:

- `overrideBlocked approve` is one human **substituting their judgment** for the missing second
  reviewer. Quorum exists to stop that.
- The carryover is the requirement being **satisfied by evidence**. Intake and renewal already
  treat a still-valid prior check as a *complete* substitute for the 2-of-N review — zero
  attestations, no reviewers involved ([intake.ts:390](../../checkin-app/src/lib/membership/intake.ts:390)).
  That is settled policy, not a loophole.

The partial attestation is likewise not an obstacle. A `REJECT` moves the row to `BLOCKED`
immediately ([review.ts:230](../../checkin-app/src/lib/membership/review.ts:230)), so a row still sitting at
`PENDING_BG_REVIEW` holds zero or one **APPROVE**. It simply no longer needs a second one.

**The actual obstacle is field overloading.** `bgClearedAt` means two things at once:

1. *the background-check requirement is satisfied* — the carryover makes this true;
2. *a reviewer has read this household's note* (#900/#907) — the carryover says nothing about it.

`clearBackgroundCheck` sets the field for both because in its world they always co-occur: two
reviewers approved **and** had the note on screen. And because the reviewer queue keys on
`bgClearedAt: null` ([lifecycle.ts:139](../../checkin-app/src/lib/membership/lifecycle.ts:139)), stamping
fact 1 silently removes the row from the only surface where fact 2 ever happens. That is exactly
the "stamping `bgClearedAt` alone strands the application" failure identified on the issue.

**So the split is on the note, not on quorum:**

| condition | why | action |
|---|---|---|
| note still present | BG satisfied; note unread. Stamping drops it out of the queue. | **do not stamp** — `notifyReviewers()` so the queue sees the new evidence |
| note deleted since the hold | nothing remains for a human to read | **clear it** — stamp + converge, same as any other state |

The second row is a real case: leads can delete a note at any time
([household/settings/route.ts:28](../../checkin-app/src/app/api/household/settings/route.ts:28)) and nothing
re-advances the held row when they do. It sits there with its cause gone. The carryover is a
legitimate way out.

**Do not stay silent in the first case.** The operator changed the facts under a held application
and should learn it. The merge already owns the mechanism: `analyze` surfaces conflicts and the
POST **400s** until the operator answers ([route.ts:180](../../checkin-app/src/app/api/membership-ops/participants/merge/route.ts:180)).
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
[household/settings/route.ts:28](../../checkin-app/src/app/api/household/settings/route.ts:28)) and has
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
parameter. Three call sites: [intake.ts:390](../../checkin-app/src/lib/membership/intake.ts:390),
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
| `PENDING_BG_REVIEW` | note-held, PERSON_BG, or blocked-reset | **actively holding** | **never clears** (two-reviewer rule) — but **discloses + pings reviewers** | reviewers only |
| `PENDING_PAYMENT` (parallel, `bgConsentAt` set) | review runs alongside payment | **ran, found none — any note here is unread** | **stamp only** — status already correct. Note clause **UNRESOLVED** | a later `activate()` now lands `ACTIVE` instead of `PENDING_BG_CLEARANCE` |
| `PENDING_BG_CLEARANCE` | paid, waiting on the check | **ran, found none — any note here is unread** | **stamp + `ACTIVE`** + flip `OrgMembership.status`. Note clause **UNRESOLVED** | existing `clearBackgroundCheck` edge |
| `BLOCKED` | a reviewer **rejected** | n/a | **nothing, ever** | only `overrideBlocked`, board-only |
| `RENEWAL_PENDING_BG` | dead-but-guarded legacy (unreachable per `LIFECYCLE.md`) | n/a | **nothing** | n/a |
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
([lifecycle.ts:129](../../checkin-app/src/lib/membership/lifecycle.ts:129)) and pre-decides `activate()`'s
`activating = !!process.bgClearedAt` branch ([payment.ts:208](../../checkin-app/src/lib/membership/payment.ts:208)).

**`PENDING_BG_REVIEW` becomes a no-op, which mostly deletes the issue's headline case.** See
[the predicate](#the-predicate) for why a live note read there opens a hole rather than closing
one. The practical effect: the state #1396 names is the one state the carryover will not touch.
That is the correct outcome — a held row is held *for a human*, and no automatic path should
release it — but it means the fix's value lives entirely in the parallel-track states.

## Reachability correction

The issue's repro says "an in-flight application sitting at background-check review". For a
household `INITIAL`, `PENDING_BG_REVIEW` is reachable only three ways
([lifecycle.ts:258](../../checkin-app/src/lib/membership/lifecycle.ts:258)):

- `advanceExternalIfComplete` with `holdForNote` — **requires an intake note**
- `personBgTriggers` — that's a `PERSON_BG`, not a household application
- `overrideBlocked reset` (note / PERSON_BG)

Every one of those is either a `PERSON_BG` (scoped out) or note-held. Combined with the no-op
decision above, **the carryover never fires in the state the issue names.**

The states it can help are the parallel-track ones — `PENDING_PAYMENT` and
`PENDING_BG_CLEARANCE` — which the issue doesn't mention, plus `PENDING_EXTERNAL_ACTION`. **The
fix is worth roughly what the issue claims, in entirely different states than it names** — and
only if open question 0 resolves toward the transition-gate reading. Under the standing-flag
reading, a household with a live note gets nothing at any state, and the fix shrinks to
`PENDING_EXTERNAL_ACTION` plus note-free households.

### Latent gap, not in scope

A `PENDING_BG_REVIEW` row whose note is later deleted stays held forever — nothing re-runs
`advanceExternalIfComplete` on a note edit
([household/settings/route.ts:28](../../checkin-app/src/app/api/household/settings/route.ts:28) writes the
note and nothing else). Reviewers still have to act on a hold whose cause is gone. Pre-existing,
unrelated to merge, worth its own issue.

### PERSON_BG is a separate question

Merge re-points `subjectPersonId` to the keeper
([merge/route.ts:326](../../checkin-app/src/app/api/membership-ops/participants/merge/route.ts:326)), so a
`PERSON_BG` at `PENDING_BG_REVIEW` follows the survivor. But `householdBgIsFresh` is a *household
leads* predicate — the wrong question for a `PERSON_BG`, which asks about one specific person.
Clearing a `PERSON_BG` from a merge needs a person-scoped freshness predicate that doesn't exist.

**Recommendation: scope PERSON_BG out of this change.** State it explicitly in the PR rather than
letting the household predicate leak onto a subject-scoped row.

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
([review.ts:302](../../checkin-app/src/lib/membership/review.ts:302)), and merge deliberately leaves
`householdId` on the old household
([merge/route.ts:355](../../checkin-app/src/app/api/membership-ops/participants/merge/route.ts:355)). So the
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
  ([merge/route.ts:205](../../checkin-app/src/app/api/membership-ops/participants/merge/route.ts:205)) throws
  `AlreadyMergedError` on the second attempt, so the carryover cannot run twice for one pair.
- **Merge racing a reviewer's 2nd approval** is guarded upstream: `attest` gates on
  `awaitingBgReview.has`, which requires `bgClearedAt = null`. Whichever lands first excludes the
  other. No double congrats.
- **`applyVolunteerStatus`** is sticky and additive — never clears — so calling it from the merge
  is idempotent by construction. It **must** be called: the fresh-check shortcut exists precisely
  because `clearBackgroundCheck` never runs that cycle, and without it a pre-designated volunteer
  household gets non-volunteer dues (#874). Same hole applies here.
- **One atomic write** per `LIFECYCLE.md` rule 4 — status + `bgClearedAt` + `stageEnteredAt` in a
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

Per [`LIFECYCLE.md`](../../checkin-app/docs/designs/LIFECYCLE.md):
- Rule 3 — the CAS guard's from-state clause comes from `fromWhere(edge)`, not a hand-written
  `status:`. The guard↔`TRANSITIONS` parity test enforces it.
- Rule 5 — regenerate `docs/generated/lifecycle/membership.md`; the artifacts-drift test fails
  otherwise.
- No new status, so `classify`'s exhaustive switch and `INVARIANTS` are untouched. The
  `active-is-bg-cleared` invariant is satisfied by construction (the stamp is in the same write).

## Shape

Extract from `clearBackgroundCheck` ([review.ts:295-317](../../checkin-app/src/lib/membership/review.ts:295))
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
  ([merge/route.ts:215](../../checkin-app/src/app/api/membership-ops/participants/merge/route.ts:215)). This is
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

## Open questions

All three are board-policy calls, not implementation preferences. Ordered by how much they change
the fix.

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

| Finding | Severity |
|---|---|
| The merge never compares the two households' membership states, so a paid membership can be stranded on a household with no live members, and a denied household can be escaped by merging out of it | **More serious than #1396** |
| `LIVE_PERSON` is applied inconsistently, so a household left holding only merged-away members becomes a permanent unactionable board to-do and reaches the keyholder emergency sheet | Moderate |
| The merge's lead guard counts merged-away records, spuriously refusing valid merges | Moderate |
| A merge can leave one person with two concurrent `PERSON_BG` reviews | Moderate |

### Related work

- [#1260](https://github.com/innovationtreehouse/checkin/issues/1260) per-adult background-check
  subjects — design merged as [`BG_PER_ADULT_SUBJECT.md`](BG_PER_ADULT_SUBJECT.md). **Sequence that
  slice first.** Both rewrite the same household clearance branch, so a textual conflict is
  certain; rebase this onto it. They compose semantically — that design makes clearance stamp
  named subjects, while this carryover deliberately stamps nobody, reusing an existing date rather
  than minting a new one. Its *Merge is an ongoing source* section is the other half of
  [Provenance](#provenance).
- [#1429](https://github.com/innovationtreehouse/checkin/issues/1429) volunteer-onset trigger —
  independent; no interaction with the merge path.
