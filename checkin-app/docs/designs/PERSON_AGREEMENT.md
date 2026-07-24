# Individual adult-child membership agreement (PERSON_AGREEMENT)

Status: **PROPOSED — for review**
Issue: [#1224](https://github.com/innovationtreehouse/checkin/issues/1224) · Backlog item **M6** (ENHANCE · NEEDS-DESIGN · size M)
Related: SA1 18+ background-check trigger (`PERSON_BG`) — this is the *agreement* side of turning 18, not the BG side.

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
   We therefore lean on the convention **both signing adults are marked household lead**; every
   other member who is 18+ is treated as an adult child. A household running with one lead + an
   un-marked spouse cannot be distinguished and would wrongly flag the spouse — acceptable given
   the cap-2-leads convention, and correctable by marking the spouse a lead.

2. **The signer must authenticate.** The Zoho recipient is the signing person's own account
   (`recipientEmail = user.email`, already required). An adult child must have an email on their
   `Person` and sign in via Google SSO. The lead supplies that email (via my-household) when the
   person needs it. No new auth work beyond the email→Person link SSO already performs.

3. **`PERSON_BG` is the established precedent** for a person-scoped obligation: a process with
   `orgMembershipId = null` and `subjectPersonId` set, judged by age as-of a boundary, opened by
   an activation trigger + an annual sweep, idempotent and Person-row-locked. This design mirrors
   it closely so the two "turns 18" obligations behave consistently.

## Design

### Model

New enum value `OrgMembershipProcessKind.PERSON_AGREEMENT`, a direct mirror of `PERSON_BG`:

- `subjectPersonId` = the adult child; `orgMembershipId` = null.
- Reuses existing process columns: `contractSignedAt`, `zohoEnvelopeId`, `zohoActionId`.
- **No new columns.** Migration is a single additive enum value — safe (no drop/rename, no
  NOT NULL backfill).

### Population — who needs one

Base rule: **≥18 as-of the boundary ∧ NOT `isHouseholdLead` ∧ live person ∧ program-attached**,
within a member household. This is the `PERSON_BG` population **minus the leads** (leads sign the
household agreement instead).

**Program-attachment window (open detail — needs a decision).** "Program-attached *now*" is too
narrow: a member may become program-attached later in the year, after the trigger has already run.
We therefore widen to **attached now OR within roughly the last year**. This deliberately
*overshoots* — a graduating senior who has left is still flagged for a cycle — which we accept and
manage with messaging (the family can ignore an obligation for someone who has aged out / left).

Implementation snag: there is **no clean per-attachment timestamp**. `ProgramParticipant` has
`pendingSince`; `ProgramVolunteer` has **none**; `Program.leadMentor` has only the program's own
`startAt`/`endAt`. **Decided: proxy via the Program's active window** — a person counts as
"attached in the last year" if they are attached to any `Program` whose `startAt`/`endAt` overlaps
`[now − 12 months, now]`. This is a proxy, not exact per-person attachment history; a real
per-attachment end date is a later investment only if precision proves to matter.

### Triggers

Clone `personBgTriggers.ts` into `personAgreementTriggers.ts`:

- `openPersonAgreement(personId, asOf)` — idempotent, `FOR UPDATE` lock on the Person row,
  dedup-guarded (opens nothing if one is already in flight for the cycle, or already signed).
- **Activation** — on INITIAL → ACTIVE, open one for each qualifying adult child in the household
  (mirror `openPersonBgForNewMember`).
- **Annual sweep** — at the renewal boundary, open a fresh agreement for each qualifying adult
  child, so the individual agreement re-signs every cycle exactly like the household one (mirror
  `runPersonBgAnnualSweep`). A mid-year 18th birthday is caught at the next annual run — no
  realtime birthday cron, same as SA1.
- **Manual board buttons (new) — build both.** Off the membership boundary, because the automatic
  population can't catch every case (someone who becomes attached between runs, or a judgement call
  the board makes directly). Two buttons, same manual-open shape, different kind:
  - "This person needs an **agreement** now" → opens a `PERSON_AGREEMENT` if none is open.
  - "This person needs a **BG check** now" → opens a `PERSON_BG` if none is open (mirror of the
    existing `submitPersonBgForReview` manual path).

### Signer + unblocking the lead-only gate

`getOrCreateContractSigningUrl(userId)` today: finds the household's INITIAL/RENEWAL process, gates
on `isHouseholdLead || isSysadmin`, sets the recipient to the calling user.

Change: **resolve which process to sign first.**
- If the caller has an open `PERSON_AGREEMENT` with `subjectPersonId === userId`, sign *that*. The
  recipient is already the caller (themselves), so the Zoho path is unchanged. The
  `isHouseholdLead` gate is **bypassed for this case only** — you are signing your own agreement.
- Otherwise fall back to the household INITIAL/RENEWAL path, **lead-gated exactly as today**.

`markContractSigned` gains a kind branch: a `PERSON_AGREEMENT` flips straight to `ACTIVE` (reusing
the existing terminal status — no new enum value) and **skips `advanceExternalIfComplete`** (it has
no membership, no payment, no BG gate).

### Rendering

- **Subject** (`/membership`): a "Sign your individual membership agreement" card appears when they
  have an open `PERSON_AGREEMENT`, mirroring the household lead's sign card. This is the surface the
  gate-unblock exists for.
- **Lead / ops:** informational visibility of outstanding adult-child agreements — *not* a gate.
  Enough for the board to chase them by hand.

### Gating

**None.** The household ACTIVE transition never waits on a `PERSON_AGREEMENT`, exactly as
`PERSON_BG` runs in parallel and only the final activation waits on the *household* check.
Enforcement is manual to start.

## Open questions for review

1. **Flagging & rules messaging (TBD).** The design leans on rules a family has to understand, and
   two of them produce false positives that need a reasonable way to be surfaced and explained:
   - **Overshoot** — a graduating senior / someone who has left is flagged for a cycle by the
     "attached in the last year" window. We need to tell the family "you can ignore this one, they
     have aged out / left."
   - **Spouse edge case** — a household with one lead + an 18+ non-lead spouse would flag the
     spouse (we can't distinguish spouse from adult child in data). The fix a family takes is to
     mark the spouse a lead — but they have to be told that.

   Both are the same underlying need: a clear surface that says *why* an individual agreement was
   requested and *what to do* if it does not actually apply (ignore it / mark them a lead).
   Copy and placement still to be figured out.

## Migration / safety notes

- Adding the enum value is additive and safe on live data.
- The signing-gate change is a branch, not a rewrite — the household lead flow is untouched; only
  the self-signing case is newly permitted. Cover with a test that a non-lead **cannot** sign the
  household agreement but **can** sign their own PERSON_AGREEMENT.
- `personAgreementTriggers.ts` reuses `PROGRAM_ATTACHED_WHERE` and the Person-row-lock idempotency
  pattern from `personBgTriggers.ts`.
