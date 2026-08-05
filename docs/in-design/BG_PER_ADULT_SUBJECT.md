# Per-adult background-check subjects (household path)

Issue: [#1260](https://github.com/innovationtreehouse/checkin/issues/1260)
· Scope/related work in the [appendix](#appendix--issue-scope-and-related-work).

## Problem

When two reviewers approve a household's background check, the system marks **every adult lead in
that household** as background-checked — not just the one whose check was actually reviewed.

So an adult who has never been checked, whose report does not exist at the vendor, shows up
everywhere as cleared. They can volunteer with youth indefinitely and appear compliant. Worse, the
false mark also hides them from the reports designed to catch exactly this, and it is refreshed
every time the household renews, so they never surface.

The system has no way to do better today: nothing anywhere records **who** a household's check was
for. There is one consent checkbox per household, one timestamp with no person attached, and the
vendor link is a single shared URL with no per-person identity.

## Objective

**A background-check date on a person means that person was checked.** Nothing else should ever set
it.

Two constraints on getting there: membership must keep working exactly as it does today (it requires
one checked adult, not all of them), and the families applying should not have to do anything new.

## Executive summary

| | |
|---|---|
| **Reviewers** | Gain one checkbox group on the review card — *whose check did you review?* Still one Approve click. |
| **Applicants** | **No change at all.** Same consent checkbox, same copy, same flow. |
| **Data** | Only the adults a reviewer named get a check date. One nullable FK column on an existing table; no new table. |
| **Board force-approve** | Names its subjects too — today's override path would otherwise stamp nobody. |
| **Membership** | Unchanged. Still one checked adult; household freshness rollups and activation timing untouched. |
| **Existing bad data** | Corrected by the board through a worklist on the compliance dashboard they already use — no script, no SQL, no prod access. |
| **Cost** | One column, one reviewer-UI change, and one unique-constraint change that needs hand-written SQL. |

The insight that makes it cheap: **the reviewer is already holding the vendor's report, and it names
the person.** Recording that name is one extra click on a screen only board members see — versus
asking every applying family to self-declare who submitted what, which is both more work and worse
evidence.

## Rules this design obeys

Canonical home is the rules register, `docs/rules/membership.md` § *Background checks*
([#1445](https://github.com/innovationtreehouse/checkin/pull/1445), open) — **collapse this to a
pointer once that merges.** Restated here only because the design is unreadable without them.

1. **Membership requires ONE background-checked adult lead** — not all of them. *(Membership Policy,
   Art. VI §VI.1)*
2. **A second adult's check is a VOLUNTEER obligation, never a membership gate.** *"Every volunteer
   18 or older is checked. The obligation attaches to the role, not only to the household"*
   *(Volunteer Policy, Art. IV)* — this design's thesis in the policy's own words.
3. **Checks are per-adult.** One person's check must never satisfy another's. This is the rule the
   current code breaks.
4. **There is no informal volunteering.** Every volunteering adult is recorded as a
   `ProgramVolunteer`, so that roster is authoritative rather than best-effort — which is what makes
   the write fix *sufficient* rather than merely necessary.

Rules 1 and 2 are why the household-level rollups are **correct as written** and stay untouched (see
[Read side](#read-side--unchanged-and-why)). The defect is entirely on the write side.

One seam worth watching: the register says checks cover any adult *"present regularly"*, where this
design's population is `ProgramVolunteer`-driven. Those coincide only because of rule 4.

## How it breaks today

`clearBackgroundCheck`, household branch — [`review.ts:305`](../../checkin-app/src/lib/membership/review.ts):

```ts
await tx.person.updateMany({ where: { householdId, isHouseholdLead: true }, data: { lastBackgroundCheck: now } });
```

When two reviewers approve one household application, **every household lead** (cap 2, see
`MAX_HOUSEHOLD_LEADS`) gets `lastBackgroundCheck = now` — whether or not they consented, whether or
not a check for them exists at Averity at all. The `PERSON_BG` branch immediately above it
([`review.ts:290`](../../checkin-app/src/lib/membership/review.ts)) does the right thing and stamps only
`subjectPersonId`.

This is known and deliberate legacy. The policy block at
[`personBgCheck.ts:18-21`](../../checkin-app/src/lib/membership/personBgCheck.ts) states it outright:

> Checks are PER-ADULT. One person's check must never satisfy another's — in particular a
> household lead's check does not cover a second volunteering spouse. (The legacy household
> clearBackgroundCheck still blanket-stamps all leads; PERSON_BG stamps only its subject.
> Removing the household blanket-stamp is deferred work.)

### Root cause

**Nothing in the household path ever records who the check was for**, at any step:

| Surface | Writes | Scope |
|---|---|---|
| Applicant checkbox "I submitted my consent on Averity" ([`membership/page.tsx:881`](../../checkin-app/src/app/membership/page.tsx)) | `OrgMembershipProcess.bgConsentAt` | **per process**, no person FK |
| Board backstop `mark-bg-consent` | same column | per process |
| Reviewer "Attest — check is clean" | `BackgroundCheckAttestation{processId, reviewerId, …}` | **per process × reviewer**, no subject |
| 2nd APPROVE, `PERSON_BG` | `Person.lastBackgroundCheck` (1 row) | **per person** ✅ |
| 2nd APPROVE, household | `Person.lastBackgroundCheck` (**all leads**) | **per household** ❌ |

The Averity link is one static org-wide URL (`AVERITY_CONSENT_URL`,
[`manual-adapter.ts:13`](../../checkin-app/src/lib/membership/background-check/manual-adapter.ts)) with no
per-person token, so no integration supplies the subject either.

So the fix is not "narrow the `updateMany`" — there is no recorded subject to narrow it *to*. The
subject has to be captured somewhere. **The reviewer is holding the Averity PDF, which names the
person.** That is the authoritative source, it already exists in the flow, and capturing it there
costs the applying family nothing.

### Why this matters — an unchecked adult reads as checked

**The membership consequence is nil.** Under rule 1 the household really does have one checked
adult, so it really is compliant; nobody's membership is wrong.

**The safety consequence is the whole defect.** Rule 3 exists because an adult around youth must
have their own check. The blanket stamp makes an adult who has never been checked — one whose PDF
does not exist at Averity — read as `FRESH` to every consumer in the system. They can volunteer
with youth indefinitely while every surface reports them cleared. That is the failure, and it
compounds because the false stamp also removes them from the machinery that would otherwise catch
it:

1. `personBgVerdict` returns `FRESH` for them.
2. → `openPersonBg` skips them ([`personBgTriggers.ts:49`](../../checkin-app/src/lib/membership/personBgTriggers.ts),
   dedup guard b — becoming the shared `personBgOpen.where` StateSet under
   [#1449](https://github.com/innovationtreehouse/checkin/pull/1449); same semantics), so neither the
   annual cohort sweep (Trigger A) nor new-member activation (Trigger C) ever opens a `PERSON_BG`.
3. → They never appear in `peopleNeedingBgCheck` on the board compliance dashboard.
4. **The loop re-arms every cycle.** Their stale stamp keeps them out of the nag, and the next
   household clearance re-stamps them fresh. They can volunteer indefinitely, unchecked, and never
   appear anywhere.
5. Person merge takes the newer compliance date unconditionally
   ([`merge/route.ts:94`](../../checkin-app/src/app/api/membership-ops/participants/merge/route.ts)), so a
   falsely stamped duplicate propagates its date onto the survivor.

A volunteering second lead is already a `ProgramVolunteer` — guaranteed, per rule 4 — and therefore
already in the `programParticipants ∪ programVolunteers ∪ programsLed` population that both
`openPersonBg` and `peopleNeedingBgCheck` scan. **They are already meant to be nagged. The false
stamp is the only thing suppressing it.**

That is why the write fix alone restores the intended behaviour, with no new nag surface: rule 4
makes the population complete, so removing the false stamp is *sufficient*, not merely necessary.
Every adult who is unchecked and around youth becomes visible the moment their stamp stops lying.

## Scope

**In:**
- Record **which adult** each background check covers, captured by the reviewer from the PDF.
- Stamp only that adult on clearance.
- Remediate the households already mis-stamped (see [Remediation](#remediation)).

**Out:**
- Any change to the applicant's consent flow. Unchanged.
- Any change to the household-level freshness rollups — correct under rules 1–2, see below.
- Non-lead adults: already correctly handled by `PERSON_BG`. Untouched.
- Enforcement/blocking. Warn-only stays warn-only.
- The consent link/email automation and cron cohort-open — the rest of SA1, separate slices.

## Design — how it works

The reviewer already opens each Averity PDF to decide whether the check is clean. The PDF names its
subject. Recording that name is one extra click on a surface only board members touch.

### Model

One nullable column on an existing table. **No new table.**

```prisma
model BackgroundCheckAttestation {
  …
  /// The adult whose Averity check this attestation covers, as read off the PDF by
  /// the reviewer. Null on PERSON_BG (the process already names its subject) and on
  /// legacy household rows attested before per-adult subjects existed.
  /// @sensitivity:public
  subjectPersonId Int?
  subjectPerson   Person? @relation("BgAttestationSubject", fields: [subjectPersonId], references: [id])

  @@unique([processId, reviewerId, subjectPersonId])
}
```

One reviewer may now hold several attestations on one household process — one per adult they
reviewed, when a family submitted more than one form. `subjectPersonId` is a real FK, so a subject
can never point at a person who does not exist.

### Reviewer surface

The card gains one checkbox group above the existing Approve/Reject buttons:

```
Rivera Household (application #482)
Alex Rivera <alex@…>, Sam Rivera <sam@…>

Whose check(s) did you review?
  ☑ Alex Rivera          — 1 of 2 approvals
  ☐ Sam Rivera           — 0 of 2 approvals

  [ Attest — check is clean ]   [ Reject ]
```

One `POST` as today, now carrying `subjectPersonIds: number[]`; `attest` writes one attestation row
per selected subject inside the existing transaction. **The reviewer clicks Approve once**, exactly
as now — the selection is the only addition. Usually it will be a single name.

- **Per-subject approve counts**, not one process count. A subject is cleared at 2 approvals from
  distinct-household reviewers.
- **Reject stays whole-process.** A reviewer concerned about *any* PDF rejects, which blocks the
  household exactly as today. Per-subject verdicts change no outcome and are not built; adding them
  later is additive (`result` moves onto the per-subject row).
- **Selection required on APPROVE.** An empty selection is a 400, not a silent no-op — a reviewer
  who approves without naming anyone is the blanket-stamp bug in human form.
- The card lists **all live household leads**, so a reviewer holding a PDF for a lead the system
  thinks is already fresh (a family who re-checked early) can still name them.
- `isMarkedVolunteer` and the intake note stay **process-level** (household properties).
  `applyVolunteerStatus`'s existing `attestations.some(a => a.isMarkedVolunteer)` is unchanged.

**Eligibility filtering shifts from per-process to per-subject.** `eligibleReviewProcessIds`
([`review.ts:161`](../../checkin-app/src/lib/membership/review.ts)) currently drops a process once the reviewer
has any attestation on it; now it drops it only when the reviewer has attested every outstanding
named subject. Same for `reviewQueueCounts`'s `approvedAwaitingSecond`. The same-household-reviewer
and same-household-applicant exclusions stay **process-scoped** — a reviewer's household-mate should
not touch any part of that family's review.

**Per-subject counts are computed server-side**, returned as a derived
`subjects: [{ personId, name, approvals, isFresh }]` shape rather than by putting attestation rows in
the response. That keeps reviewer identities out of the payload (today only a `_count` is returned,
deliberately — showing reviewer A that reviewer B already signed off invites anchoring) and keeps
`BackgroundCheckAttestation` out of the route's `returns` bag and the edge-include drift guard.

### Clearance

```ts
// Stamp the adults this review actually covered — read off the Averity PDFs by the
// reviewers. `subjectOverride` is the board force-approve path, which asserts the
// subjects directly instead of counting attestations (see below). Legacy rows carry
// no subject and deliberately stamp nobody.
const cleared = subjectOverride ?? subjectsWithTwoApprovals(process.attestations); // personId[]
if (cleared.length) {
    await tx.person.updateMany({ where: { id: { in: cleared } }, data: { lastBackgroundCheck: now } });
}
```

**`bgClearedAt` fires on the FIRST subject to reach two approvals** — per rule 1, one checked adult
satisfies the membership obligation. The payment/activation convergence, `applyVolunteerStatus`, the
`FOR UPDATE` lock, and the audit row are all unchanged. Membership timing does not move.

**A second subject left at 1/2 is not stranded, and needs no special handling.** Once `bgClearedAt`
is set the process leaves the reviewer queue (`awaitingBgReview` gates on `bgClearedAt: null`,
[`lifecycle.ts:131`](../../checkin-app/src/lib/membership/lifecycle.ts)), so a half-approved second subject stops
accumulating there. That is correct: their obligation is a *volunteer* obligation, and it belongs on
the `PERSON_BG` track, which already picks them up —

- **Trigger C** (`openPersonBgForNewMember`) fires on INITIAL activation for every program-attached
  household member, and
- **Trigger A** (`runPersonBgAnnualSweep`) catches them at the next boundary regardless.

Both call `openPersonBg`, which now — with no false stamp — correctly reads them as `NEEDED`. The
handoff is free.

**New failure mode: the split-subject stall.** If reviewer 1 names only Alex and reviewer 2 names only
Sam, *neither* reaches 2/2, `bgClearedAt` never fires, and the process sits in the queue awaiting a
third reviewer who shares a household with neither of the first two. On a small board that pool can be
empty, and it is a stall that **cannot occur today** — one attestation per reviewer means two
approvals always converge.

Accepted, not designed away: the alternative is letting one reviewer's subject choice bind the other's,
which defeats the independence the two-reviewer rule exists for. Two things keep it from being silent —
the `subjects[]` payload renders per-subject counts on the card, so reviewer 2 sees Alex sitting at 1/2
before choosing, and the board's force-approve (above) resolves any stall outright. Reviewers should be
told to name every adult whose PDF they actually read, not just one.

**Legacy rows stamp nothing.** A pre-deploy process whose attestations carry no subject yields an
empty `cleared` set, so no `Person` row is written. Conservative on purpose: better a household that
reads stale and gets chased than one more unchecked adult silently marked cleared. The remediation
report counts these so nobody is surprised.

### Board force-approve needs its own subject selection

`overrideBlocked(processId, actorId, "approve")` ([`review.ts:352`](../../checkin-app/src/lib/membership/review.ts))
routes into the same `clearBackgroundCheck` ([`:397`](../../checkin-app/src/lib/membership/review.ts)) — and
**counting attestations there yields the empty set every time.** A `BLOCKED` process got blocked by a
REJECT, and unlike the `reset` branch ([`:385`](../../checkin-app/src/lib/membership/review.ts)) `approve` does
**not** delete attestations. So it carries at most one APPROVE per subject — a second would already
have cleared it. `subjectsWithTwoApprovals` can never reach 2.

Left unaddressed this is not a legacy tail but a permanent path that **inverts the override's
purpose**: the board force-approves, `bgClearedAt` is set, the membership activates — and no adult is
stamped at all, so the household reads `STALE_BG` immediately and holds a `bgClearedAt` with no person
behind it. Strictly worse than today, where the override at least stamps someone.

**The override asserts subjects directly.** It already bypasses the two-reviewer count for
`bgClearedAt`; it does the same for the stamp. `overrideBlocked` takes `subjectPersonIds`, passes them
as `subjectOverride`, and those adults are stamped on the board member's authority. Counting is not
attempted, because there is nothing to count.

- The board's action UI (`/membership-ops/applications`, the `review-override` POST) gains the same
  lead checkbox group as the reviewer card.
- **Non-empty selection required** on a household process, same 400 as `attest`. An override that
  names nobody is the blanket-stamp bug wearing a different hat.
- `reset` is unaffected — it deletes attestations and returns the process to review, where the normal
  per-subject flow applies.
- The existing conflict-of-interest gate on `overrideBlocked`
  ([`:364`](../../checkin-app/src/lib/membership/review.ts), `hasHouseholdConflict`, sysadmin-bypassable) already
  stops a board member force-clearing their own household. Naming subjects does not widen it.

**The `LIVE_PERSON` omission on this line is already fixed elsewhere.**
[#1455](https://github.com/innovationtreehouse/checkin/pull/1455) adds `...LIVE_PERSON` here
minimally — deliberately not restructuring the logic, since that is this design's job. The
subject-id form removes the concern by construction anyway. The exposure was small: the merge CAS is
the only non-null writer of `mergedIntoId` and clears `isHouseholdLead` in the same write
([`merge/route.ts:210-216`](../../checkin-app/src/app/api/membership-ops/participants/merge/route.ts)), so a
tombstone flagged as a lead could only be residue from merges predating that.

The wider class is not small, and is tracked separately as
[#1456](https://github.com/innovationtreehouse/checkin/issues/1456). #1455 widened the drift guard to
see writes and renamed Person relations and immediately flagged **19 sites, 13 of which were silently
wrong** — including an authorization check a merged-away identity could satisfy, and a `take: 1` lead
lookup a tombstone could shadow entirely. This design needs none of that; noted so the line's history
is legible.

### Read side — unchanged, and why

An earlier revision of this design proposed flipping the household rollups from "any lead fresh" to
"every lead fresh". **That was wrong** — it would impose a stricter membership requirement than
rule 1. All three stay exactly as they are:

| Site | Current behaviour | Verdict |
|---|---|---|
| `householdBgIsFresh` ([`renewal.ts:319`](../../checkin-app/src/lib/membership/renewal.ts)) | `findFirst` — any one fresh lead ⇒ household fresh | **Correct.** Membership needs one. Drives the intake shortcut, renewal shortcut, `STALE_BG`. |
| [`membership-ops/households/route.ts:109`](../../checkin-app/src/app/api/membership-ops/households/route.ts) `+:194` | `reduce` to the **later** lead date | **Correct.** Household stays member-eligible until the last check lapses. |
| [`membership-audit/compliance/route.ts:154`](../../checkin-app/src/app/api/membership-audit/compliance/route.ts) | same max reduce | **Correct**, same reason. |

Per-adult visibility is not this rollup's job — it is `peopleNeedingBgCheck`'s, which is already
person-scoped and already includes volunteering leads. Nothing to add.

**Latency, not coverage, is the remaining gap.** With the stamp fixed, a newly-volunteering second
lead surfaces at the next Trigger A boundary or Trigger C activation — correct, but potentially
months late. Firing at volunteer assignment instead is exactly
[#1429](https://github.com/innovationtreehouse/checkin/issues/1429) (SA11), and it composes cleanly
on top of this: it needs the same `personBgVerdict` to stop lying before it can fire on the right
people. Sequence #1260's slice first.

## Alternatives considered

**Capture the subject at consent time** (per-lead checkboxes on `/membership`, backed by a
`BackgroundCheckSubject(processId, personId, consentAt)` join table). An earlier revision of this
design; superseded on every axis:

| | Consent-side | Reviewer-side |
|---|---|---|
| Data source | family's honour-system claim | the Averity PDF itself |
| Catches "family submitted only one form" | no — the box gets ticked anyway | yes — the second subject never reaches 2 approvals |
| Schema | new table | one nullable FK column |
| Applicant UI | new per-lead checkbox flow | **unchanged** |
| Reviewer UI | display-only | one checkbox group |

It also overstated the requirement to the family: two checkboxes read as "both adults must do this",
which contradicts rule 1.

**Fan out into one `PERSON_BG` per lead** at intake. Rejected — the household process would have no
attestations of its own, and `isMarkedVolunteer` + the intake-note display hang off exactly those.
Also front-loads a volunteer obligation onto a membership application, inverting rules 1–2.

**`subjectPersonIds Int[]` on the attestation** instead of one row per subject. Avoids the unique-
constraint work below. Rejected — the schema has **zero** scalar-list precedent (every relation is a
table or an FK), and a scalar array carries no referential integrity, so an id could silently point
at a merged-away person. Wrong trade on a compliance path.

## Remediation

The write fix stops new pollution. It does not undo pollution already in the database, and the
polluted rows are exactly the ones hiding unchecked volunteers from the nag.

**No script, no SQL, no prod shell.** The instance lives in AWS and is a pain to reach directly, so
remediation is a board-clickable surface in the app. It also should be: deciding which of two adults
actually had a check is a judgement call against the Averity PDFs, and the people holding those PDFs
are board members, not whoever has database access.

**Almost all of it already exists.** The mutation is
[`PUT /api/membership-ops/participants/[id]`](../../checkin-app/src/app/api/membership-ops/participants/[id]/route.ts)
— board/sysadmin gated, accepts `lastBackgroundCheck: null` to clear a stamp, and already writes a
proper `AuditLog` row with `oldData`/`newData` and the acting board member as `actorId`. Its UI is the
edit modal on `/membership-ops/participants`. A board member can correct a bad stamp today, unaided.

**The only missing piece is the worklist** — knowing *which* stamps are wrong. That is a read.

### What the board sees

One new section on the existing `/membership-audit/compliance` dashboard, which is already
board-gated, already where this work belongs, and already renders exactly this shape twice (the
`PersonSection` component backing `peopleNeedingBgCheck` / `peopleMissingDob`). Reusing the page
avoids a new route file, a nav entry, and a `pageRegistry` entry.

```
Background-check stamps to confirm                                   (12 households)
Each of these households had one check approved, but every lead was marked checked.
Confirm who actually had the check; clear the others.

  Rivera Household — cleared 2026-07-14
    Alex Rivera   alex@…    consent submitted by Alex Rivera        ← likely subject
    Sam Rivera    sam@…                                             [ Clear this stamp ]

  Chen Household — cleared 2026-07-02
    Dana Chen     dana@…    consent marked by board (Pat Okafor)    — cannot tell
    Jo Chen       jo@…      consent marked by board (Pat Okafor)    — cannot tell
                                                        [ Clear ]        [ Clear ]
```

Rows are grouped by household, sorted by clearance date. Each lead shows whatever evidence exists,
and `Clear this stamp` calls the existing `PUT` with `lastBackgroundCheck: null`. One click per
correction. The section disappears when the list empties.

### Where the evidence comes from

The route computes the list; **no human runs a query.** Two lookups, both exact:

1. **Which households were blanket-stamped.** In `clearBackgroundCheck` a single
   `const now = new Date()` ([`review.ts:300`](../../checkin-app/src/lib/membership/review.ts)) is written to
   *both* every lead's `lastBackgroundCheck` **and** the process's `bgClearedAt`. So the join key is
   equality to the millisecond, not a heuristic: household processes (`subjectPersonId` null) with
   `bgClearedAt` set, joined to leads whose `lastBackgroundCheck` equals it, keeping only groups of
   more than one.

   Three classes fall out on their own and need no special-casing: single-lead households (group of
   one), fresh-check-shortcut rows (`intake.ts:397` / `renewal.ts:210` stamp `bgClearedAt` without
   touching any `Person`, so they join to zero leads — expect many, correct not a miss), and
   `PERSON_BG` rows (excluded by `subjectPersonId` being null).

2. **Who probably had the check.** `markBgConsent` writes exactly one `AuditLog` row per process with
   `newData.bgConsentAt = true`, and its `actorId` is whoever attested
   ([`external.ts:181`](../../checkin-app/src/lib/membership/external.ts)):

   | `actorId` | What the row shows | Board action |
   |---|---|---|
   | one of the stamped leads | "consent submitted by *name*" — self-attestation | keep theirs, clear the other |
   | not a lead of that household | "consent marked by board (*name*)" — the backstop | cannot tell; check the PDFs |
   | no audit row | "no consent recorded" — shortcut or pre-audit row | cannot tell; check the PDFs |

   Self-attestation should be the bulk, since the applicant checkbox is the primary path and the
   board mark is documented as the backstop. The dashboard **labels** the likely subject; it never
   pre-selects or auto-clears. A board member clicks.

### Merge is an ongoing source, not part of the one-time cleanup

Separately surfaced: survivors of a person merge whose `lastBackgroundCheck` arrived via the
newer-wins rule in `resolveKeeperUpdate`
([`merge/route.ts:92-100`](../../checkin-app/src/app/api/membership-ops/participants/merge/route.ts)), which takes
the later of the two dates **unconditionally, with no subject provenance**.

**This list does not empty, and the write fix does not touch it.** The whole thesis of this design is
that a `lastBackgroundCheck` must trace to a named subject's PDF; every future merge can still mint one
that traces to nothing. So this sub-list is a **permanent** dashboard section, not part of the
blanket-stamp cleanup — [step 6](#order-of-operations) deletes the blanket-stamp list only.

Closing the hole properly is **deferred to [#1396](https://github.com/innovationtreehouse/checkin/issues/1396)**
(merge transfers the BG date but leaves the application at review), which owns merge/BG provenance.
This design deliberately does not redesign the merge rule.

**Cross-reference for #1396:** the merge route is gated by `withAuth({ roles: ['isSysadmin',
'isBoardMember'] })` and has **no conflict-of-interest check** — unlike `overrideBlocked`, which calls
`hasHouseholdConflict` ([`review.ts:364`](../../checkin-app/src/lib/membership/review.ts)) precisely to stop a board
member clearing their own household. A merge is therefore an unguarded route for a board member to
place a background-check date on a person in their own household. Out of scope here; worth carrying
into #1396's design.

### Deliberate departure: the dashboard gains an action

The compliance route documents itself as **PULL-ONLY**. That property is about *automation* — "the
system deliberately never auto-revokes; a human must follow up" — and a board member clicking a
per-row button is that human following up, not the system acting. Still, this is the first mutation
on that page and a reviewer should sign off on it rather than have it slip in. It is confined to one
verb: clear one person's stamp, via the pre-existing `PUT`. Nothing is bulk, nothing is automatic,
and no process or `bgClearedAt` is ever touched.

**Blast radius of a wrong click is small, and should shape how hard the board works each row.**
Clearing the wrong lead's stamp cannot cost anyone their membership (rule 1 — the household keeps its
other checked adult). It puts that person in the volunteer nag queue; worst case is a redundant
re-check request. That argues for clearing when the evidence is thin rather than long archaeology —
[open question 2](#open-questions-for-review) asks the board to confirm that trade.

### Cutoff — a filter control, not a hardcoded date

The board's stated cutoff is **2026-07-01**: everyone was re-imported per-adult after the DB change,
which is why backlog **SA2** ("wipe polluted blanket BG data") was retired on 2026-07-21 as *"no
polluted data exists"*. That retirement was about pre-import pollution. New pollution has been
accruing from every household clearance since — the blanket `updateMany` never stopped running.

The section therefore ships with **no date filter applied by default** and a "cleared since" control.
The board looks at the full list first, sees the real distribution of clearance dates, and narrows
only once the cutoff is confirmed against actual data. Cheap to validate, expensive to assume, and it
costs one input instead of a redeploy if 2026-07-01 turns out to be wrong.
`docs/backlog/INDEX.md:303` currently asserts the opposite and should be updated with what the list shows.

### Order of operations

1. **Deploy the code fix first.** Correcting stamps before the write fix ships lets the old blanket
   `updateMany` re-pollute on the very next household clearance.
2. Board opens the section unfiltered, reads the date distribution, confirms the cutoff.
3. Board works the list — self-attested rows are quick; "cannot tell" rows go against the Averity PDFs.
4. Watch `peopleNeedingBgCheck` on the same page: corrected volunteering leads surface there.
   **That count going up is the remediation working**, not a regression — brief the board before step 3
   so the spike is expected. Household `STALE_BG` counts should barely move, since membership only
   ever needed one checked adult.
5. Update `docs/backlog/INDEX.md:303` with what the list showed.
6. **Delete the blanket-stamp list** once it empties — that part is one-time cleanup, not a permanent
   surface: legacy processes clearing after the deploy stamp *nobody*, so no tail accumulates and the
   existing `STALE_BG` bucket already catches those households. **The merge sub-list stays** until
   [#1396](https://github.com/innovationtreehouse/checkin/issues/1396) closes the provenance hole — see
   [above](#merge-is-an-ongoing-source-not-part-of-the-one-time-cleanup).

### Rejected: re-running the affected reviews

Reopening the cleared processes so reviewers re-attest with subjects named would reuse the new UI
neatly, but clearing `bgClearedAt` regresses `ACTIVE` memberships and puts a data cleanup on the money
path. Not worth it to avoid a dozen button clicks.

## Migration / safety notes

- **Column add is additive** — nullable FK, no backfill, no `NOT NULL` on an existing column. Safe
  through the rolling-deploy drain window: old code ignores it, new code treats subject-less rows as
  legacy.
- **The unique constraint needs care.** Replacing `@@unique([processId, reviewerId])` with
  `@@unique([processId, reviewerId, subjectPersonId])` weakens duplicate protection for legacy and
  `PERSON_BG` rows, because Postgres treats `NULL`s as **distinct** in a unique index — two
  `(process, reviewer, NULL)` rows would both be allowed. Postgres 15 (confirmed: `postgres:15` in
  both `deploy/docker-compose.yml` and `.github/workflows/migration-safety.yml`) supports
  `UNIQUE NULLS NOT DISTINCT`, which restores it. Prisma cannot express that attribute, so the index
  goes in as **raw SQL in the migration**, and the resulting schema drift must be reconciled via
  `scripts/compare-schema-dumps.sh` — call it out in the migration's comment header so the next
  `coalesce-migrations` run does not silently regenerate a plain unique.
  The in-transaction `already_attested` check under the existing `FOR UPDATE` process lock
  ([`review.ts:214`](../../checkin-app/src/lib/membership/review.ts)) is what actually serializes concurrent
  attestations; the index is defence-in-depth. Do not let it quietly become less than that.
  *(Considered and not taken: denormalising `subjectPersonId` onto `PERSON_BG` attestations — the
  process already names its subject — would shrink the null population to legacy rows only. It does
  not remove the raw-SQL requirement, so it buys little; noted because this design reasons explicitly
  about which rows carry null.)*
- **Security boundary ships in its own PR.** A new FK on `BackgroundCheckAttestation` plus its
  `@sensitivity` annotation touches `scopeBindings.ts` and the generated classifications — per the
  boundary-isolation rule in `AGENTS.md` that lands **before** the app-code PR, with no feature code.
- **Drift guard avoided by design.** Returning a derived `subjects` shape rather than attestation rows
  keeps `BackgroundCheckAttestation` out of the `GET /api/membership/reviews` `returns` bag, so no
  `EDGE_INCLUDE_ALLOWLIST` entry is needed. If that changes, it needs one with a justification.
- **`tsc` is not sufficient.** The approval-counting change (per-process → per-subject) is semantic
  and type-identical. Covered by integration tests, not the compiler. Run `test:integration`
  `--runInBand`.

## Test plan

The bug is currently invisible to the suite: both integration tests that assert the stamp
([`membershipReviewAPI:135`](../../checkin-app/src/app/__tests__/membershipReviewAPI.integration.test.ts),
[`membershipBgNonBlocking:141`](../../checkin-app/src/app/__tests__/membershipBgNonBlocking.integration.test.ts))
use **single-lead** households, so nothing locks in the blanket behaviour and nothing catches its
removal. New coverage, mirroring the `PERSON_BG` safety assertion at
[`personBgTriggers.integration.test.ts:199`](../../checkin-app/src/app/__tests__/personBgTriggers.integration.test.ts)
("household-mate untouched"):

- **The regression itself** — two-lead household, both reviewers name only Alex ⇒ Alex stamped and
  **Sam's `lastBackgroundCheck` stays null**. This is the test that would have caught the report.
- **Membership is unaffected** — same scenario, household still reaches `ACTIVE`, `bgClearedAt` set,
  `householdBgIsFresh` still `true`. Rule 1 holds; the fix does not tighten the membership gate.
- **The nag turns on** — Sam is a `ProgramVolunteer`; after clearance `personBgVerdict(Sam)` is
  `NEEDED`, Sam appears in `peopleNeedingBgCheck`, and Trigger C opens a `PERSON_BG` for Sam. Today
  all three are false.
- Both reviewers name both leads ⇒ both stamped.
- Reviewer 1 names Alex, reviewer 2 names Sam ⇒ **nobody** stamped, both at 1/2, process stays queued
  (the split-subject stall — an accepted new failure mode, asserted so it stays deliberate).
- APPROVE with an empty subject selection on a household process ⇒ 400.
- **Board force-approve stamps its named subjects.** `overrideBlocked(…, "approve", { subjectPersonIds: [alex] })`
  on a BLOCKED process carrying one APPROVE + one REJECT ⇒ Alex stamped, `bgClearedAt` set. Without
  the subject override this is the case that silently stamps nobody, so assert the stamp, not just
  the status.
- Force-approve with an empty subject selection ⇒ 400.
- Force-approve `reset` still deletes attestations and returns the process to review unchanged.
- A reviewer who has attested Alex but not Sam still sees the process in `eligibleReviewProcessIds`.
- Legacy row whose attestations carry no subject: clearance stamps **no** `Person` row, and
  `bgClearedAt`/activation still happen.
- Remediation list: a blanket-stamped two-lead household appears; a single-lead household and a
  fresh-check-shortcut process (`bgClearedAt` set, no `Person` stamped) do **not**.
- Remediation evidence labelling: consent actor is a stamped lead → that lead is labelled the likely
  subject; board-marked or no audit row → labelled "cannot tell". Nothing is ever pre-selected.

A flow test is optional — the journey is already covered end-to-end and the change is service-level.

## Open questions for review

1. **Cutoff.** Is 2026-07-01 confirmed, or does the unfiltered report widen it? (Step 1 of the
   remediation answers this with data; do not assume it.)
2. **"Cannot tell" rows.** Given the low stakes (a wrong call costs a redundant re-check, never a
   membership), is "when in doubt, clear the stamp and let the nag run" acceptable — or does the board
   want the Averity PDFs reconciled first? This decides how much of the list is a few minutes' work
   versus an afternoon.
3. **Reviewer subject list — leads only, or any household adult?** The card lists live household
   leads. If a PDF names someone who is not a lead (an adult child, a mis-recorded name), the reviewer
   has nowhere to put it. Reject and route to `PERSON_BG`, or allow selecting any live household member?

## Appendix — issue scope and related work

**#1260 is scoped to exactly this defect**, decomposed from the original five-slice SA1 bundle. This
design is the whole of it: an implementation PR carries `Fixes #1260`; a design-doc PR references it
plainly, no closing keyword. The other former slices, none of them dependencies:

| Former slice | Now |
|---|---|
| cron cohort-open | **already shipped** — `api/cron/person-bg-annual/route.ts` calls `runPersonBgAnnualSweep` |
| consent link/email | [#961](https://github.com/innovationtreehouse/checkin/issues/961) 18+ student nudges — PERSON_BG has no in-app consent orchestration; the only path is the board's manual `submitPersonBgForReview` → `markBgConsent` (`personBgSubmit.ts:14`) |
| self-attest widening | [#1452](https://github.com/innovationtreehouse/checkin/issues/1452) (SA17) — self-attest must accept a bare PERSON_BG obligation; blocks #961 |
| enforcement/grace blocking | SA18 — warn-only is by design (`backlog/CUJS.md:235`), board-gated by SA5. Explicitly **not** proposed here |
| supplier affirmation | unresolved — no code, no backlog context beyond the INDEX line; needs clarification before anyone scopes it |

**Resolves a flagged backlog TODO.** `docs/backlog/INDEX.md:303` retired SA2 warning *"⚠ likely also
moots SA1's 'blanket-stamp→per-adult migration' sub-part — verify when SA1 is scoped."* Verified
while scoping this: **it does not moot it.** SA2 was pre-import *data*; the blanket `updateMany`
never stopped running, so new pollution has accrued from every household clearance since. That line
needs correcting, and INDEX's SA1 row needs to match #1260's reduced scope.

**Related issues**

- [#1429](https://github.com/innovationtreehouse/checkin/issues/1429) (SA11) **volunteer-onset BG
  trigger** — the same second-adult case, fired when an adult *starts volunteering* rather than at the
  annual sweep. Complementary: this design makes the second adult visible, #1429 makes them visible
  *sooner*. Its "when a SECOND adult volunteers, BOTH adults need a check" wording needs reconciling
  against rule 1 — it is a volunteer trigger, not a membership requirement.
- [#1396](https://github.com/innovationtreehouse/checkin/issues/1396) participant merge transfers the
  BG date — owns the merge-provenance hole this design defers to it.
- [#1456](https://github.com/innovationtreehouse/checkin/issues/1456) remove `LIVE_PERSON` — would
  make the tombstone note under [Clearance](#clearance) moot entirely.
- [#1224](https://github.com/innovationtreehouse/checkin/issues/1224) `PERSON_AGREEMENT` — **design
  only, never implemented** (the enum has no such kind). The agreement side of the same "individuals,
  not households" shift. Not a dependency.

Unblocks **SA3** (household-composition sweeps), which needs a per-adult predicate.
Also see: `personBgCheck.ts` policy block (the rule this violates) · `checkin-app/docs/designs/HOUSEHOLD_LEAD_MODEL.md`.
