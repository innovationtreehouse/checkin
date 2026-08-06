# Intake note acknowledgement

A proposal. Origin: the note field added in #900 and the hold added in #907;
changes the disposition PR #1499 proposes for both.

---

## Problem

An applicant's "anything else we should know?" note either stops the application
dead or reaches nobody, and which one happens depends on a background-check date
the family never sees.

**Today on `main`, a note stops payment until two reviewers clear a background
check.** `advanceExternalIfComplete` holds the process at `PENDING_BG_REVIEW`
when a note exists and `bgClearedAt` is null
(`checkin-app/src/lib/membership/external.ts:112`). The note is not what gets
reviewed — the background check is — so the family waits on a 2-of-N review of
something unrelated to what they wrote.

**It is worse for a household that already holds a valid check.** A note
disqualifies the fresh-check shortcut in both `submitIntake`
(`intake.ts:392`) and `beginRenewal` (`renewal.ts:192`), so that household
consents to a **redundant background check** for no reason other than to become
visible to a reviewer. Writing a sentence in a text box costs them a check they
did not need.

**#1499 removes both couplings, and the note then reaches nobody in the case
that matters.** With the shortcut restored, a household with a valid check gets
`bgClearedAt` stamped at intake. The reviewer queue is `awaitingBgReview`, whose
predicate requires `bgClearedAt: null` (`lifecycle.ts:152-157`), so that process
never enters the queue. The note is stored, displayed nowhere, and read by no
one. Renewals are the common case for a valid check, and a returning
volunteer-only household is precisely who the field exists for.

Both settings are wrong. One charges a family a background check to have a
sentence read; the other loses the sentence.

## The rule

**If a note is provided, the board must read it; then the application
proceeds.**

Reading is an *acknowledgement*, not a decision. One board member, recorded. It
is not the 2-of-N background-check review, and it must not be coupled to it —
that coupling is the whole of the problem above.

## Design

### The obligation belongs to the process; the note belongs to the household

`Household.intakeNotes` is a nullable `String`, `@sensitivity:pii`, and editable
at any time from household settings
(`checkin-app/src/app/api/household/settings/route.ts:28`) — including after a
board member has read it, and including to `null`.

So "the board read it" is a claim about a string that can change afterwards. An
acknowledgement that records only *who* and *when* is not checkable a week
later. **The acknowledgement records what was read**, and a later edit re-opens
the obligation.

### Model

Mirror `BackgroundCheckAttestation` (`schema.prisma:507`), which is the existing
shape for "a named person asserted something about a process":

```prisma
model IntakeNoteAcknowledgement {
  id        Int      @id @default(autoincrement())
  processId Int
  process   OrgMembershipProcess @relation(fields: [processId], references: [id])
  readerId  Int
  reader    Person   @relation("IntakeNoteReads", fields: [readerId], references: [id])
  readAt    DateTime @default(now())
  noteRead  String   // the note text as acknowledged
}
```

`noteRead` carries the same disclosure as `intakeNotes` and is `pii`. Storing the
text rather than a hash keeps the audit answerable — "what did they actually
read" is the question a dispute asks, and a hash cannot answer it.

### The gate sits before ACTIVE, not before payment

**Decided.** An applicant willing to complete payment should be allowed to
complete it. Nothing about an unread note should stand between a family and the
checkout they are ready to finish; the note is the organisation's obligation, not
theirs, and making them wait on it charges them for our queue.

So membership does not become `ACTIVE` while a live note is unacknowledged.
Payment, contract, and background-check consent all proceed exactly as they do
today.

**This costs more than the alternative did, and the cost is the reason to build
it carefully.** Gating before payment would have been one predicate in
`advanceExternalIfComplete`. `ACTIVE` has **five** entry edges
(`lifecycle.ts` `TRANSITIONS`):

| From | Event | Site |
|---|---|---|
| `PENDING_PAYMENT` | `activate` | `payment.ts:204` |
| `PENDING_PAYMENT` | `grantRenewalPayment` → `activate` | `renewal.ts:339` |
| `PENDING_BG_REVIEW` | `clearBackgroundCheck` | `review.ts:256/304` |
| `PENDING_BG_CLEARANCE` | `clearBackgroundCheck` | `review.ts:326` |
| `BLOCKED` | `overrideBlocked approve` | `review.ts:411` |

Five sites is five places to forget, and the repo's own convention says an
invariant everyone must remember is not an invariant
(`docs/conventions.md`). **The check belongs in one predicate that every edge
calls**, next to the existing `FOR UPDATE` guards rather than beside them — the
two `PENDING_PAYMENT` edges already funnel through `activate()`, so the real
count is three call sites, and a drift test should pin that no new edge into
`ACTIVE` bypasses it.

Nothing here reads `bgClearedAt`. The background-check track is untouched, and a
household with a valid check keeps its shortcut.

### What a paid-but-unread note means for money

Gating after payment accepts a consequence #1499 named for its own design: a
household that wanted volunteer dues, or was asking for hardship consideration,
**has already paid full dues** by the time anyone reads the sentence saying so.

That is not an argument against the decision — it is the price of not making a
willing payer wait. But it means the note-reading surface has to be able to hand
off to the existing remedies rather than dead-end: the volunteer designation
(`applyVolunteerStatus`), the scholarship hold ledger, and whatever refund or
credit path finance already uses. **Acknowledging is still not deciding** (§"What
this is not"); the reader's job is to route, and the routing targets already
exist.

The alternative reading — block payment — was rejected precisely because it
punishes the applicant for an organisational delay.

### Where it surfaces

**Not the background-check reviewer queue.** That queue filters on
`bgClearedAt: null`, which is exactly the filter that loses the fresh-check
households this design exists to serve. It needs its own board-facing list of
processes with an unacknowledged live note, ordered oldest first.

### Relationship to #1499

#1499 is right that a note should not gate on a background-check clearance, and
right to restore the fresh-check shortcut. This design keeps both. What it adds
back is the reading requirement, on a track of its own, so that removing the
coupling does not also remove the reader.

## What this is not

- **Not a decision.** Acknowledging is not approving, and carries no verdict
  field. If the note asks for something — volunteer dues, a hardship
  consideration — acting on it is a separate, existing workflow.
- **Not 2-of-N.** One reader. The plural review exists because a background
  check is a judgement two people should share; reading a sentence is not.
- **Not a background-check hold.** The two tracks no longer touch.
- **Not a restoration of the fresh-check disqualification.** A household that
  holds a valid check does not consent to a redundant one in order to be seen.

## Open questions

1. **What happens if nobody reads it?** The one that still needs an answer, and
   the one most likely to bite. Because the gate sits before `ACTIVE` rather than
   before payment, an unread note now strands a household that has **already
   paid** — which is a worse place to stall than the checkout was. Options: a
   staleness notice to the board after N days; auto-activate after N days with
   the obligation left open and visible; or a hard commitment that the list is
   worked before some cadence. This has no technical answer.

2. **Does every edit re-open the obligation, or only a material one?** Fixing a
   typo should not send a household back to the queue. A trimmed, case-folded
   comparison is the cheap approximation; anything cleverer is guessing at intent.

3. **Who counts as "the board"?** Board members only, or background-check
   reviewers too? The queue's existing gate is
   `canReviewBackgroundChecks` (`review.ts`), which is broader.

4. **Do renewals need re-reading?** A household that wrote a note three years ago
   and renews every year: is that one obligation or one per cycle? Recommendation:
   per cycle, because the note is attached to the process, and a note that still
   says something worth saying is worth re-reading.

## Cost

One model and migration, one mutation, one board list, and one predicate change
in `advanceExternalIfComplete`. The two shortcut-disqualification lines in
`intake.ts` and `renewal.ts` are deleted rather than replaced, which is what
#1499 already proposes.

Notably it removes work: no household consents to a background check it does not
need in order to be read.
