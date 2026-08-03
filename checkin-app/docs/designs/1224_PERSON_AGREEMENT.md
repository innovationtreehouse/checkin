# Individual adult-child membership agreement (PERSON_AGREEMENT)

Status: **AGREED — ready to build**
Issue: [#1224](https://github.com/innovationtreehouse/checkin/issues/1224) · Backlog item **M6** (ENHANCE · NEEDS-DESIGN · size M)
Related: SA1 18+ background-check trigger (`PERSON_BG`) — this is the *agreement* side of turning 18, not the BG side.
Related: [#1462](https://github.com/innovationtreehouse/checkin/issues/1462) — program attachment has no exit state. Not a blocker; see "Considered and dropped".

## Problem

Today a household signs **one** household-level membership agreement. The household lead is the
Zoho recipient; the signature is recorded as `contractSignedAt` on the household's INITIAL/RENEWAL
`OrgMembershipProcess`, and it re-signs fresh every renewal cycle.

A minor child is covered by that household signature. Once a child turns **18** they are a legal
adult and can no longer be bound by a parent's signature — they need to sign **their own**
individual agreement. A spouse does **not**: a spouse stays on the household agreement.

## Scope

**In:**
- A per-person agreement obligation, modeled as a new `OrgMembershipProcess` kind.
- Triggers that open it (activation, annual boundary, and a manual board button).
- Unblocking the signing flow so a non-lead adult can sign their *own* agreement.
- Surfaces: the subject signs on `/membership`; leads/ops get visibility of outstanding ones.

**Out (for now):**
- Structured spouse/child relationship modeling (see "Domain constraints").
- Automated blocking/enforcement — non-blocking, enforced by hand to start.
- Self-service BG-consent attestation by the subject — adjacent SA-item; the same login
  unblock helps it, but it ships separately.

## Domain constraints (why the shape is what it is)

1. **No spouse-vs-child field exists.** `Person` carries only `isHouseholdLead` (bool, cap 2
   leads/household) and age (`dateOfBirth` / `isDeclaredAdult`). There is no relationship type.
   The automatic population is therefore drawn narrowly enough that the distinction doesn't have
   to be made — see "Population" below.

2. **The signer must authenticate.** The Zoho recipient is the signing person's own account
   (`recipientEmail = user.email`, already required). An adult child must have an email on their
   `Person` and sign in via Google SSO. The lead supplies that email (via my-household) when the
   person needs it. No new auth work beyond the email→Person link SSO already performs.

3. **`PERSON_BG` is the established precedent** for a person-scoped obligation: a process with
   `orgMembershipId = null` and `subjectPersonId` set, idempotent and Person-row-locked, opened by
   an activation trigger plus a periodic one. The model and the concurrency pattern are reused
   verbatim. Two things deliberately **diverge** — the age reference (as-of `now`, not as-of the
   boundary) and the cadence (nightly, not annual); see Population and Triggers for why. Do not
   "fix" this file to match `personBgTriggers.ts` on those two points.

## Design

### Model

New enum value `OrgMembershipProcessKind.PERSON_AGREEMENT`, a direct mirror of `PERSON_BG`:

- `subjectPersonId` = the adult child; `orgMembershipId` = null.
- Reuses existing process columns: `contractSignedAt`, `zohoEnvelopeId`, `zohoActionId`.
- Opens at `PENDING_EXTERNAL_ACTION` (the status the signing flow already selects on), and the
  signature flips it straight to `ACTIVE`.
- **No new columns.** Migration is a single additive enum value — safe (no drop/rename, no
  NOT NULL backfill).

### Population — who needs one

The automatic rule is deliberately narrow: it must never ask a **spouse** to sign an individual
agreement, and it must reach that guarantee from the fields we actually have.

**Automatic population — all five must hold:**

1. **NOT `isHouseholdLead`** — a lead signs the household agreement.
2. **In a member household** — the household's `OrgMembership` is ACTIVE.
3. **Live person** (`LIVE_PERSON`, not a merge tombstone).
4. **Program-attached** — `ProgramParticipant` ∪ `ProgramVolunteer` ∪ `Program.leadMentor`, the
   same predicate `PERSON_BG` uses (`PROGRAM_ATTACHED_WHERE`). We don't need a legal agreement
   from someone who isn't in the building; if we do, the board triggers it by hand.
5. **`dateOfBirth` on file AND 18 ≤ age ≤ 25** as of **now** (inclusive at both ends).

**Age is judged as-of `now`, NOT as-of the membership-year boundary.** `PERSON_BG` judges age
as-of `nextBoundary(now)` — always the *upcoming* boundary — which is only safe because that sweep
is meant to fire once, at the boundary, where `nextBoundary(now) ≈ now`. This trigger runs nightly
(below), and boundary-relative age run nightly would flag a **17-year-old** whose 18th birthday
falls any time before the next boundary: asked to sign a contract they cannot legally be bound by,
which is the exact failure this feature exists to prevent. As-of-`now` age is the only correct
reading for a nightly trigger.

**Why the age band is the spouse guard.** `isDeclaredAdult` means "over 25, no DOB on file" — set
at intake by the over-25 checkbox, and also stamped automatically by the #1165 nightly purge on
everyone who crosses 26. A non-lead adult **over 25** is a spouse the household didn't mark as a
lead, or an adult child who should by then have their own household — either way a household
data-hygiene item, not a signature obligation. A non-lead **18–25 with a DOB** is a child who
turned 18. The band buys the spouse/child distinction that no field records.

**The ceiling is written explicitly, not inherited.** Post-#1165 a person with a DOB is
necessarily ≤25, so `age >= 18` alone would pick out the same set today. It is still written as
`18 ≤ age ≤ 25`, because the implicit version depends on another feature's side effect and has a
reachable hole: a household adds a 30-year-old spouse via my-household **with** a date of birth
and doesn't mark them a lead — until the next nightly purge that person has a DOB and is 30, and
an implicit rule would flag them. One comparison closes it.

**Manual (board) population.** The manual button is the escape hatch and carries only the guards
that prevent a wedged state, NOT the automatic narrowing:

- **No program-attachment requirement** — that is the button's whole purpose.
- **No age ceiling** — the board can see that a 27-year-old is an adult child and not a spouse.
- **Still refuses a household lead** (see the resolver rule below — an open `PERSON_AGREEMENT` on
  a lead would shadow the household signing flow).
- **Still requires a known age** — `dateOfBirth != null || isDeclaredAdult`, i.e. anyone the BG
  dashboard classifies as `DOB_MISSING` is refused. Fix the age first; the compliance page already
  surfaces those people in its "Missing date of birth" section.

### Triggers

New `personAgreementTriggers.ts`, modeled on `personBgTriggers.ts`. There is **no separate annual
sweep**: one nightly trigger does both jobs — it opens the first agreement when a person starts
qualifying, and opens a fresh one after each cycle rolls. The boundary is no longer an age
reference; it only moves the dedup window.

- `openPersonAgreement(personId, now, cycleStart)` — idempotent, `FOR UPDATE` lock on the Person
  row, dedup-guarded (see below).
- **Nightly** — hosted on the existing `api/cron/nightly` route, not a new one. Cron scheduling
  lives out-of-band (nothing in `deploy/` or `.github/` schedules `person-bg-annual`), so a new
  route would ship inert until someone wired it. `nightly` is known-scheduled (it does facility
  auto-close) and already carries a comparable periodic item (the #1165 DoB purge). Idempotent, so
  running it daily is free.

  Nightly is what makes the trigger *correct*, not just convenient. A once-a-year sweep misses
  everyone who starts qualifying after it fires: a 19-year-old added to a program on **Sept 2**,
  the day after a Sept 1 boundary, would wait a full year. (That gap is what the dropped 12-month
  program-window proxy was trying to paper over — badly, since that window keys on the *program's*
  dates, not on when the person joined it.) Re-evaluating nightly closes it directly: they are
  caught Sept 3, and a January 18th birthday is caught January 16.
- **Activation** — on INITIAL → ACTIVE, open one for each qualifying adult child in the household
  (mirror `openPersonBgForNewMember`). Strictly an optimization over waiting for the next nightly
  run, so a new member isn't asked a day late; the nightly pass would catch them regardless.
- **Manual board button** — opens a `PERSON_AGREEMENT` for one person, subject to the manual
  guards above. Lives on the membership-audit compliance page next to the existing
  "Record external check & submit" (`PERSON_BG`) button.

**Cycle dedup — mirrors the household renewal window.** A person is "handled this cycle" when they
have a `PERSON_AGREEMENT` that is either:

- **in flight** — `PENDING_EXTERNAL_ACTION`, from any cycle (an unsigned obligation is not a reason
  to open a second one), or
- **settled this cycle** — terminal (`ACTIVE`/`ARCHIVED`) with `stageEnteredAt >= windowStart`,
  where `windowStart = boundary − RENEWAL_LEAD_MONTHS` — the same window
  `runRenewalSweep` uses via `settledThisCycleWhere` ([lifecycle.ts:171](../../src/lib/membership/lifecycle.ts)).

Dedup-ing from `windowStart` rather than from the boundary itself is what stops a double-ask: a
person who starts qualifying on Aug 20 signs, and without the lead-month window the Sept 1 rollover
would ask them again two weeks later. The household flow already solved this exact shape; this
mirrors it so the individual agreement and the household agreement roll on the same cycle.

The clause is written locally in `personAgreementTriggers.ts` rather than by extending
`settledThisCycleWhere`, which is hardcoded to `kind: "RENEWAL"` and belongs to the #1080 lifecycle
work — same shape, different kind. With no boundary configured the guard degrades to "one ever".

### Signer + unblocking the lead-only gate

`getOrCreateContractSigningUrl(userId)` today: finds the household's INITIAL/RENEWAL process, gates
on `isHouseholdLead || isSysadmin`, sets the recipient to the calling user.

Change: **resolve which process to sign first.**
- **A household lead always signs the household INITIAL/RENEWAL process** — check `isHouseholdLead`
  *first* and take the lead-gated path, exactly as today. This ordering is required: a stray open
  `PERSON_AGREEMENT` on someone who is (or becomes) a lead must **never** shadow the household
  process, or activation/renewal would stall with no UI explanation. (The NOT-lead guard on the
  triggers/button should keep a lead from ever having one — this resolver order is the belt-and-
  suspenders backstop.)
- Otherwise, if the caller has an open `PERSON_AGREEMENT` with `subjectPersonId === userId`, sign
  *that*. The recipient is already the caller (themselves), so the Zoho path is unchanged. The
  `isHouseholdLead` gate is **bypassed for this case only** — you are signing your own agreement.
- Otherwise fall back to the household INITIAL/RENEWAL path (a non-lead here → `not_lead`, as today).

`markContractSigned` gains a kind branch: a `PERSON_AGREEMENT` flips straight to `ACTIVE` (reusing
the existing terminal status — no new enum value) and **skips `advanceExternalIfComplete`** (it has
no membership, no payment, no BG gate).

**Return-from-signing sync must cover the new kind too.** `syncContractStatus`
([external.ts:280](../../src/lib/membership/external.ts)) is the reliable completion leg — it runs on
`?signed=1` when the signer returns, because the inbound Zoho webhook is documented as unreliable
against a scale-to-zero instance. It resolves the process via
`household.orgMembership.processes`, which **can never contain a `PERSON_AGREEMENT`** (its
`orgMembershipId` is null). Left unchanged, an adult child who signs and returns completes *only* if
the webhook happens to fire; otherwise the card keeps demanding a signature already executed and a
re-click mints a second ceremony. `syncContractStatus` must resolve the subject's own open
`PERSON_AGREEMENT` (by `subjectPersonId = userId`) with the same precedence as the signing resolver
above.

### Rendering

- **Subject** (`/membership`): a "Sign your individual membership agreement" card appears when they
  have an open `PERSON_AGREEMENT`, mirroring the household lead's sign card. This is the surface the
  gate-unblock exists for. The copy states the ask and that nothing is blocked; it does **not**
  invite the reader to decide whether it applies to them (see "Considered and dropped").
- **Lead / ops:** informational visibility of outstanding adult-child agreements — *not* a gate.
  Enough for the board to chase them by hand, and the surface the manual button lives on.

### Gating

**None.** The household ACTIVE transition never waits on a `PERSON_AGREEMENT`, exactly as
`PERSON_BG` runs in parallel and only the final activation waits on the *household* check.
Enforcement is manual to start.

## Considered and dropped

- **A 12-month `Program.startAt`/`endAt` overlap window** (with a NULL-date rule so undated
  programs count as open) instead of plain program attachment. It existed to bound the "attached to
  a program that ended long ago" false positive. Dropped: it is a proxy for data we don't have, and
  the age band plus the manual override already keep the population honest. The underlying gap —
  attachment has no exit state, withdrawal hard-deletes the row — is [#1462](https://github.com/innovationtreehouse/checkin/issues/1462),
  tracked separately and **not** a blocker here.
- **Family-facing "you can ignore this one" copy** for people who have aged out or left. Dropped as
  undeliverable: there is no class year, no graduation state, and no attachment history, so the
  system cannot tell a person who left from one who stayed. The only honest version would be a
  generic caveat shown to everyone, which trains people to ignore a legal-agreement request. The
  narrow automatic population removes the need for it.
- **"Mark your spouse as a household lead" instructional copy.** Unnecessary once the age band
  excludes over-25 non-leads from the automatic population.
- **A board classification click as the first step** (board asserts "adult child, not spouse", then
  the system auto-renews). Unnecessary — `isDeclaredAdult` already carries that signal, so the rule
  re-derives it every cycle with no human in the loop and nothing to remember.
- **A dedicated `api/cron/person-agreement-annual` route.** Would ship inert; see the Triggers note.
- **An annual boundary sweep, mirroring `runPersonBgAnnualSweep`.** Fires once a year, so it misses
  everyone who begins qualifying after it runs — the Sept 2 enrolment above waits a year. Replaced
  by the nightly trigger, which subsumes both the first open and the per-cycle re-open.
- **Boundary-relative age (`nextBoundary(now)`), copied from `PERSON_BG`.** Correct only for a
  once-a-year sweep. Run nightly it flags minors; see the Population note.

## Migration / safety notes

- Adding the enum value is additive and safe on live data.
- The signing-gate change is a branch, not a rewrite — the household lead flow is untouched; only
  the self-signing case is newly permitted. Cover with a test that a non-lead **cannot** sign the
  household agreement but **can** sign their own PERSON_AGREEMENT.
- `personAgreementTriggers.ts` reuses `PROGRAM_ATTACHED_WHERE` and the Person-row-lock idempotency
  pattern from `personBgTriggers.ts`, and adds the NOT-`isHouseholdLead` exclusion and the age band.
