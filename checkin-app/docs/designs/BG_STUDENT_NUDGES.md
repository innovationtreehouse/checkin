# Automated background-check nudges for 18+ students

## Problem

`cron/person-bg-annual` already OPENS a `PERSON_BG` obligation for every
program-attached person ≥18 (as of the membership-year boundary) with no fresh
check, and the compliance dashboard (`membership-audit/person-bg`) shows the
board who still needs one. But nothing reaches the STUDENTS. An opened
obligation just sits at `PENDING_BG_REVIEW` until a board member happens to chase
it — the automation stops at "the board can see the gap," never "the person is
told to close it."

This adds the missing half: escalating email nudges to the student's household
that carry the Averity consent deep link, with dedup plumbing so repeated daily
cron runs never re-send the same threshold.

## Interview decisions

**"Nudges + consent link", NO blocking.**

- **Escalating emails** to the student's household when a `PERSON_BG` obligation
  is open, re-sent as it goes stale at fixed thresholds.
- Each email carries the **Averity consent deep link**
  (`backgroundCheckProvider.getConsentDeepLink()`) and points at the **self-attest
  path** (`/membership`, #875) for after they've submitted on Averity.
- **Explicitly NO check-in or enrollment blocking.** Posture stays warn-only,
  consistent with the whole PERSON_BG feature (see `personBgCheck.ts` policy box).
  Rejected alternative — see below.
- **Dedup**: a small ledger table so a repeated cron run never re-sends the same
  threshold for the same obligation.

### Rejected alternative: blocking check-in / enrollment

Gating participation on a cleared check was considered and rejected. The BG
program is warn-only by board policy (`personBgCheck.ts`): an un-cleared
obligation must never block participation, check-in, or renewal. A minor who
can't legally be checked, or an adult mid-check, would otherwise be locked out of
a program they're already enrolled in. Nudges apply social pressure without a
hard stop; the board retains the manual review/clear path for genuine problems.

## Schedule + rationale (thresholds)

Nudge at obligation age **0 (open), +14d, +30d, then monthly** (60, 90, …).

- **0** — tell them the moment the obligation opens; most people act on the first
  ask.
- **+14d / +30d** — two escalations inside the first month, the window where a
  reminder still feels timely rather than nagging.
- **monthly after** — a long-tail obligation (someone who never engages) gets a
  steady monthly poke, not silence and not a daily flood.

`dueThresholdDay(ageDays)` is a pure function (unit-tested) returning the largest
threshold reached. The sequence is monotonic, so each run only ever records a
threshold ≥ the previous one — which is exactly what makes the dedup key safe.

## Data model

One additive table, `PersonBgNudge` (migration
`20260709040000_bg_student_nudges`):

| column         | notes                                                        |
|----------------|--------------------------------------------------------------|
| `id`           | pk                                                            |
| `processId`    | FK → `OrgMembershipProcess` (the PERSON_BG obligation), `onDelete: Restrict` (processes are never hard-deleted) |
| `thresholdDay` | the age bucket this nudge was sent at (0/14/30/60/…)          |
| `sentAt`       | `@default(now())`                                            |
| **`@@unique([processId, thresholdDay])`** | the dedup ledger key             |

The unique index IS the dedup mechanism: the sweep inserts the `(processId,
thresholdDay)` row (via `createMany({ skipDuplicates: true })`) BEFORE it emails.
On a re-run at the same stage the insert is a no-op (`count === 0`) and no email
goes out. Record-before-send guarantees the "never re-send the same threshold"
requirement; the accepted cost is that a rare Resend failure after the insert
loses that one nudge rather than risking a duplicate — the next threshold still
fires (marked with a `ponytail:` comment in `personBgNudge.ts`).

## Flows

**Nudge sweep** (`runPersonBgNudgeSweep`, `lib/membership/personBgNudge.ts`):

1. No-op unless `bgRecheckMonths` and `orgMembershipYearBoundary` are configured —
   the same gate as `person-bg-annual`.
2. Find OPEN obligations still awaiting the student: `kind = PERSON_BG`,
   `status = PENDING_BG_REVIEW`, `bgConsentAt = null`.
3. For each, re-check the subject with `personBgVerdict(...)` as of the boundary —
   only `NEEDED` subjects are nudged. This mirrors `person-bg-annual` eligibility
   **exactly** (same "who needs a check" rule), so under-18 (`MINOR`),
   unknown-age (`DOB_MISSING`), and already-fresh (`FRESH`) subjects are excluded.
4. Compute the due threshold from the obligation's age. Insert the ledger row; if
   newly inserted, send.

**Recipients** — mirror the existing trusted-adult notifications
(`emailHouseholdLeads`): every household lead of the subject's household, PLUS the
student themselves when they have an email on file (deduped via a `Set`). Fan-out
is best-effort through `lib/email.ts` `sendEmail`, which never rejects.

**Clearing stops nudges naturally.** No explicit "stop" signal is needed:
- The student self-attests (#875) or the board records consent → `bgConsentAt` is
  set → the obligation leaves the step-2 set.
- Two reviewers clear it → `clearBackgroundCheck` stamps the subject's
  `lastBackgroundCheck` and flips the process to `ACTIVE` → excluded by both the
  status filter (step 2) and the verdict recheck (step 3).
- A cleared-out-of-band subject (e.g. the legacy household blanket-stamp stamps a
  lead's `lastBackgroundCheck` while their separate PERSON_BG lingers) becomes
  `FRESH` → excluded by the step-3 recheck even before the obligation closes.

Asserted in the integration test: cleared / submitted / under-18 subjects get
nothing.

## Where it runs

A dedicated daily cron, `GET /api/cron/person-bg-nudge` (`withCron` +
`CRON_SECRET`), NOT an extension of `person-bg-annual`. Rationale: keep
`person-bg-annual` single-purpose (it OPENS obligations; idempotent). Sending
mail is a different concern with different failure modes (best-effort external
call) and its own dedup ledger — folding it in would couple the "open" job's
success envelope to email delivery. **Infra follow-up:** add the daily schedule
for this route alongside the other cron entries (same cadence as
`person-bg-annual`; order doesn't matter — the nudge sweep tolerates an obligation
opened the same day).

## Prod safety

- Additive/nullable-only migration (one new table); no change to existing columns.
- `withCron` gate is unit-tested (missing/wrong secret → 401).
- Best-effort email: a Resend/query failure is logged and swallowed
  (`logIntegrationError` via `sendEmail`; per-obligation try/catch around
  recipient resolution) — a bad row never aborts the sweep or fails the request.
- The Averity deep link and `/membership` are the only interpolated URLs and are
  not user-controlled, so no injection surface in the email HTML.
- Warn-only: no code path here blocks check-in, enrollment, or renewal.

## Folding into #958 (staleness framework + NotificationLedger)

This PR is deliberately STANDALONE off `main` — a minimal escalating-nudge +
dedup table, not a dependency on the open #958 sibling PR. When both merge, the
fold-in is a **registration + table merge, not a rewrite**:

1. **Ledger merge.** Drop `PersonBgNudge` (and its migration) and record nudges as
   rows in #958's `NotificationLedger` instead. The dedup key maps 1:1:
   `PersonBgNudge(processId, thresholdDay)` → a ledger row with
   `dedupKey = "person-bg:{processId}:{thresholdDay}"` (or #958's
   `type` + `subjectId` + `bucket` triple). The record-before-send discipline
   carries over unchanged.
2. **Type registration.** Register a `PERSON_BG_NUDGE` notification type in #958's
   registry, wiring in this PR's escalation schedule (`dueThresholdDay`) and email
   template (`nudgeEmail`). No new logic — the schedule and template already live
   as pure/standalone functions in `personBgNudge.ts`.
3. **Producer.** `runPersonBgNudgeSweep`'s stale-finder query (open
   `PENDING_BG_REVIEW` + `personBgVerdict === NEEDED`) becomes the `PERSON_BG_NUDGE`
   type's "who is stale" predicate feeding #958's staleness engine; the per-run
   loop and dedup insert are replaced by the framework's generic pass.

Net diff at fold-in: delete the table + migration, move ~two pure functions behind
a type registration, delete the bespoke sweep loop. The eligibility rule, schedule,
template, and recipient resolution are all reused as-is.

## Deliberately deferred

- **A PERSON_BG-specific self-attest endpoint.** The email links `/membership`
  (#875's self-attest), which today keys off the household membership process
  (`latestPendingExternal`), not a standalone PERSON_BG obligation. Wiring the
  self-attest path to accept a bare PERSON_BG obligation is #875's remit, not this
  PR's — the nudge just points at it.
- **Per-person consent links.** Averity exposes no per-person API, so the deep
  link is one static hosted URL for everyone (see `background-check/provider.ts`).
- **Board-tunable thresholds.** The schedule is a code constant; no board setting
  until there's a reason to tune it.
