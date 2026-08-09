# Intake note acknowledgement

## Problem

A family applying for membership is asked "anything else we should know?". A
household that already holds a valid background check writes its sentence there —
"treat us as a volunteer household", "we are asking for hardship consideration" —
and nobody ever reads it.

That is not a delay. Nothing is queued, nothing is late, and no screen shows the
sentence to anybody in the organisation. The family sees their application
proceed normally and assumes they have been heard.

Which families this happens to is not random. It is exactly the returning
volunteer household renewing for another year — the ones most likely to have
something worth saying, and the ones the field was added for.

## Objective

A note written by an applicant is read by a named person, and the record shows
who read it and what it said. Writing one costs the family nothing: it does not
slow their application, and it does not oblige them to a background check they
would not otherwise need.

## Executive summary

- **For applicants:** no change. Writing a note neither holds the application nor
  triggers a background check. It is now read.
- **For the board:** a list of applications carrying an unread note, worked like
  any other queue. One reader, not two.
- **What deliberately does not change:** the note does not gate payment, does not
  gate membership, and does not enter the background-check review. Those
  couplings were removed on purpose and this does not restore them.
- **Cost:** three columns on the existing process record and a migration, one
  mutation, one board-facing list, and the security-registry grant that list
  needs — which ships as its own change, before the route.

## What changed under this design

This document was written against a `main` where an intake note held the
application at background-check review, and against #1499's proposal to remove
that hold. **#1499 has since merged**, and most of what this document argued
about is gone with it.

Moot now:

- **The payment hold.** `advanceExternalIfComplete` no longer inspects the note;
  the predicate that held a noted process at `PENDING_BG_REVIEW` is deleted, not
  moved. The symbol survives only in the prose of `docs/in-design/MERGE_BG_CARRYOVER.md`.
- **The redundant background check.** Neither `submitIntake` nor `beginRenewal`
  disqualifies the fresh-check shortcut on a note any more. Both bind their
  shortcut unconditionally. A family no longer buys a check with a sentence.
- **Everything this document said about choosing where to gate.** Gating before
  payment is not an alternative that exists to be rejected; there is no longer a
  predicate there to change.

Still true, and still unaddressed:

- **The note reaches no human in the fresh-check case.** Verified against `main`
  with #1499 merged, and traced below. #1499 removed the coupling; it did not add
  a reader.

In-flight rows are not a concern. Processes parked at `PENDING_BG_REVIEW` by the
old hold sit with no clearance stamped, which is precisely the reviewer queue's
own predicate — they are in the queue, and their notes are shown. They leave it
the ordinary way, when the check clears.

## Rules this relies on or intends to change

`docs/rules/membership.md` states:

> An intake note does not hold the application. It is shown to the reviewers,
> who read it while the family pays.

The first sentence is a standing decision and this design keeps it. **The second
sentence is over-broad and this design intends to correct it.** It is true only
of applications that enter the background-check reviewer queue, and the
fresh-check household never does — which is the whole of the problem above. The
register currently promises a reader that the code does not provide.

The same file's access rule — an intake note is readable by the household's leads
and the reviewers, not by its other members — is unchanged. Widening who may read
a note is a separate decision, and the board list below is what forces it to be
made.

## The rule

**If a note is provided, a named person reads it, and the record says who and
what.**

Reading is an acknowledgement, not a decision. One reader. It is not the
two-of-N background-check review and must not be coupled to it.

## Design

### Where the note is lost

Three surfaces render `Household.intakeNotes`. Two are the family's own and both
are gated to household leads — the household view behind `GET /api/household`,
and the intake prefill's `canSeeNotes` branch. Only one is organisation-facing:
the background-check reviewer queue, `GET /api/membership/reviews`, which selects
the note and renders it on the review screen.

Nothing else reaches it. The ops people-search and the participant-merge analyzer
both project the household explicitly and comment on excluding it.

That queue's row set is `eligibleReviewProcessIds`, which filters on
`awaitingBgReview.where` in `lib/membership/lifecycle.ts`. That predicate requires
no clearance to have been stamped.

`submitIntake` stamps clearance at intake when a household guardian already holds
a valid check. So the fresh-check process is cleared before it could ever be
listed, never appears in the queue, and its note is rendered nowhere. The note is
stored, and read by no one.

Renewals take the same path through `beginRenewal`, which is why the common case
is the broken one.

### Recommended: surface it, do not gate

The gate this document originally proposed — no membership becomes `ACTIVE` while
a live note is unacknowledged — was designed when a note already held the
application. It no longer does, and `docs/rules/membership.md` now says so as a
standing rule. **Re-adding a gate on activation is re-adding a hold**, and would
need that rule amended rather than merely qualified.

The diagnosis does not ask for a gate. Nothing is stuck; something is invisible.
The cheap and sufficient fix is the reader, not the block:

- A board-facing list of applications whose note has not been acknowledged,
  oldest first, with the note shown and an "acknowledged" action.
- The acknowledgement recorded against the process.

This dissolves, rather than answers, the expensive questions the gated version
carried: where a note-blocked process sits, which entry edges must consult a
predicate, what happens to a household stranded after paying, and what to do
about processes already in flight. None of them arise if nothing is held.

The price is honest and worth stating: **an unread note stops nobody**. A
household that asked for volunteer dues can be activated at full dues before
anyone reads the request. That is the same trade #1499 already made deliberately,
and the remedies it relies on exist — the volunteer designation, the scholarship
hold ledger, and the finance refund path. The list is worked, or the note is not
acted on; there is no technical substitute for working the list.

### The gated alternative, and what it now costs

Recorded because it was the previous decision, and because its cost was
understated rather than argued.

`ACTIVE` has **six** entry edges in `TRANSITIONS`, not the five this document
previously tabulated:

| From | Event | Site | Kind |
|---|---|---|---|
| `PENDING_EXTERNAL_ACTION` | `markContractSigned` | `external.ts` | `PERSON_AGREEMENT` |
| `PENDING_PAYMENT` | `activate` | `payment.ts` | |
| `PENDING_PAYMENT` | `grantRenewalPayment` → `activate` | `renewal.ts` | `RENEWAL` |
| `PENDING_BG_REVIEW` | `clearBackgroundCheck` | `review.ts` | |
| `PENDING_BG_CLEARANCE` | `clearBackgroundCheck` | `review.ts` | |
| `BLOCKED` | `overrideBlocked approve` | `review.ts` | |

**The `PERSON_AGREEMENT` edge is out of scope for the predicate, and the reason
is structural rather than a judgement.** A `PERSON_AGREEMENT` process is opened
with no membership — `orgMembershipId` is null by construction, and
`markContractSigned` flips it straight to `ACTIVE` on the signature alone,
skipping `advanceExternalIfComplete` entirely because that function would
dereference the null. There is no household behind the process, so there is no
intake note that could have gone unread. A predicate reading the note through the
membership must return "nothing to acknowledge" for this edge rather than throw,
and the drift test must assert that exemption by name over all six edges — an
exemption nobody can see is the same failure as an edge nobody counted.

Two further corrections to what this document previously claimed:

- **The mechanism it asked for mostly exists.** `lib/membership/lifecycle.ts`
  already carries `INVARIANTS` and `validate`, and `classify` is an exhaustive
  switch that fails to compile when a status is added. The ask is one `INVARIANTS`
  entry plus the existing transition oracle, not a new pattern. The caveat matters:
  `INVARIANTS` is a **detection** oracle, not an enforcement gate. It gives the
  drift test, never the gate itself.
- **The nearest existing invariant is already blind to the sixth edge.**
  `active-is-bg-cleared` asserts that an `ACTIVE` row carries a clearance stamp.
  A settled `PERSON_AGREEMENT` is `ACTIVE` with no clearance — it never had a
  background check to clear — and `scanLifecycleViolations` runs `validate` over
  every process row without filtering on kind. The named sibling this design
  wanted to copy is, on `main`, reporting every completed person agreement as an
  off-diagram row. That is a defect in its own right and belongs in its own
  change; here it is the evidence. An invariant written against an incomplete
  edge inventory does not fail loudly — it fails as noise nobody reads.

A gate would also need a holding state. There is no honest existing candidate:
`PENDING_BG_CLEARANCE` means "paid, waiting on the board" but names the wrong
thing, and a new status pulls in new edges, a regenerated
`docs/generated/lifecycle/membership.md`, and both oracles. That work is real and
was not in the original cost.

### Model

Three columns on `OrgMembershipProcess`, not a new model:

```prisma
  /// The note as submitted with this application. Snapshot, not a live read: the
  /// household may edit or clear its note afterwards, and the audit question is
  /// what the applicant actually said.
  /// @sensitivity:pii
  intakeNoteSnapshot String?
  /// @sensitivity:public
  noteAckById        Int?
  noteAckBy          Person?  @relation("IntakeNoteReads", fields: [noteAckById], references: [id])
  /// @sensitivity:public
  noteAckAt          DateTime?
```

`Person` gains the matching `intakeNoteAcks OrgMembershipProcess[] @relation("IntakeNoteReads")`
back-relation; Prisma will not generate without both sides.

Snapshotting at submit rather than acknowledging a live string is what makes the
record answerable a week later, and it settles three questions outright: there is
no "was the edit material" comparison to define, because an edit does not re-open
anything; there is no re-read semantics; and renewals are per-cycle for free,
because each process carries its own snapshot. A household editing its note after
submit does not reach the reader — correctly, since the note is part of the
application it was submitted with.

Retention: the snapshot is disclosure-equivalent to the note itself, and a
household clearing its live note to null does not clear the snapshot — that is
the point of taking one, and it needs stating rather than discovering. It is
deleted with the process and has no separate lifetime.

Where the note is empty at submit there is no snapshot and no obligation.

### A note on citations

This document cites files and symbols and deliberately carries **no line
numbers**. The previous revision's citations were copied from the transition
table's own `guardSite` strings, and by the time it was reviewed most pointed at
the wrong function — including the strings on `main`, which have drifted from the
code they describe. A symbol name is checkable and does not rot on an unrelated
insertion.

## What this is not

- **Not a decision.** Acknowledging is not approving and carries no verdict. If
  the note asks for something, acting on it is a separate existing workflow.
- **Not two-of-N.** One reader. Two people share a background-check judgement;
  reading a sentence is not that.
- **Not a background-check hold.** The tracks do not touch, and this must not
  reintroduce the coupling #1499 removed.
- **Not a restoration of the fresh-check disqualification.** A household holding
  a valid check does not consent to a redundant one in order to be seen.
- **Not a gate.** See above; this is the reversal from the previous revision.

## Open questions

1. **Who counts as a reader?** Board members only, or background-check reviewers
   too? The existing queue gate, `canReviewBackgroundChecks`, is broader than the
   board. This decides the security grant, so it is answered before the registry
   change rather than after.

2. **What happens if the list is not worked?** With no gate the answer is milder
   than it was — nobody is stranded — but the note is still unread. A staleness
   notice to the board after some interval is the cheap answer. This is a
   commitment question, not a technical one.

3. **Does the board list widen who may read a note?** The access rule names the
   household's leads and the reviewers. If readers are board members, the rule
   changes and `docs/rules/membership.md` changes with it.

## Cost

- Three columns and a migration.
- One mutation to record the acknowledgement.
- One board-facing list route and screen.
- **The security-registry grant for that list, as its own change, merged before
  the route.** The registry carries an explicit guard against granting a
  household-scoped pii token to a lead- or keyholder-facing view returning
  household rows; reviewers reach `intakeNotes` today through the reviewer grant
  on `GET /api/membership/reviews`. A new board-facing surface cannot borrow it.

No cutover: nothing in flight is held, and no existing row needs moving. Per §4.2
there is no migration document, because nothing here expires on a nameable date.

## Appendix — provenance

The note field was added in #900 and the hold in #907. #1499 removed the hold and
restored the fresh-check shortcut; this document was written as a response to
#1499's proposal and has been re-derived against it as merged.
