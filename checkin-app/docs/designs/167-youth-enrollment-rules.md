# Youth enrollment rules (issue #167)

**Status: BUILT.** Every decision below is implemented. The out-of-scope items
at the end are deliberately not.

## Problem

Anyone with a Google-linked account can log in, open `programs/[id]`, and
self-enroll — committing themselves, and money via Shopify checkout, to a
program with no guardian involvement. The enroll route
(`api/programs/[id]/participants` POST) admits self-enrollment on nothing more
than `actor === target`. A minor can do this.

## Decision — Option A, fail closed

**Only a KNOWN adult may self-enroll.** Everyone else is refused at the enroll
route (the source of truth); the member-select UI mirrors it on the viewer's
own row.

"Known adult" = declared 25+ (`isDeclaredAdult`) OR 18+ by `dateOfBirth`.
Refusal splits into two cases by what we know:

| Self-enroller | Outcome |
|---|---|
| 18+ by DOB, or declared 25+ | Allowed |
| Under 18 by DOB | Refused → **a household lead must enroll them** |
| No DOB and not declared 25+ (age unverifiable) | Refused → **set a DOB or confirm 25+ first**, then self-enroll |

Leads, sysadmin, and board enrolling *someone else* are unaffected — a parent
still enrolls their child, staff still comp.

## Why fail closed (and why it's safe)

Two facts drove this shape:

1. **Fail closed, not open.** An earlier draft blocked only a *known* minor
   (DOB present and < 18) and let unverified-age members through. That's a hole:
   omit your DOB and the gate opens. Since the point is to keep minors from
   self-committing, "can't prove adult ⇒ refuse" is the correct posture.

2. **New accounts have no DOB — so the block must be self-serviceable, not a
   lead dead-end.** First Google sign-in auto-provisions a Person with no DOB,
   not declared adult, and makes them their own household lead. So a brand-new
   *adult* is, on paper, "age unverifiable." A hard "a lead must enroll you"
   would strand them (they have no other lead). Instead the unverifiable case
   routes to age capture, which **already exists**: the enroll page's
   FirstTimeIntakePanel collects a DOB or an "over 25" checkbox, and my-household
   lets a member set either. The enroll page already sends incomplete-profile
   users through that intake, so an adult can establish age and proceed.

   **But this leg is only as strong as self-report — see the residual-risk
   section below.** The "over 25" checkbox self-sets `isDeclaredAdult`
   (`api/household/member/route.ts:57`, `api/household/route.ts:109`) — a flag
   the schema (schema.prisma:85) intends to be *lead*-set, but which a member,
   as their own household lead, can set on themselves. A 15-year-old can hit the
   refusal, tick "over 25", satisfy the "known adult" definition, and self-enroll
   + pay. Self-entered DOB is no different. **This design does not stop a
   determined minor, and that is an accepted risk (see below).** What "fail
   closed" buys is narrow but real: a member of *unknown* age is refused by
   default. A member who *declares* adulthood — by DOB or the over-25 tick — is
   taken at their word, by decision.

Rejected alternatives (unchanged from first pass):
- **Parent-notify + hold-a-slot-for-N-hours + parent-confirms** — a real
  approval state machine (new status, cron expiry, confirm/deny route + UI,
  entanglement with the capacity/hold ledger). Justified only if teen
  self-initiation is a product goal. Machinery without a customer for a small org.
- **Allow-but-notify** — transparency without a limit; the issue asks to *limit*.

## Accepted residual risk — self-attestation

Raised by review: no self-service age input is *verified*. Both the "over 25"
checkbox (which self-sets `isDeclaredAdult`) and a self-entered DOB are
unverified self-report, so a minor willing to misreport can clear the gate and
self-enroll + pay. The only trustworthy age signal is one set by *someone other
than the subject* — a lead/board, or staff import.

The household-lead flag falls under the same acceptance. `leads.ts` blocks a
youth from becoming a lead by reading `dateOfBirth` only — it never consults
`isDeclaredAdult` — so the same misreport that clears the enroll gate clears the
lead check too. Its unknown-DOB default (`unknownIs: 'adult'`) therefore grants
a determined minor nothing that lying would not. Two residues, both narrow: it
needs no lie at all, so a youth who signs in and touches nothing is silently
made a lead (`auth-options.ts` provisions the household and calls
`addHouseholdLead` unconditionally); and lead authority is over *other people*,
which this section's reasoning about self-commitment never weighed — worth
remembering, since the paragraph below offers "a lead enrolling the minor" as
the trustworthy alternative. Reaching real third parties still requires an admin
to reassign real people into that household, so it is a design inconsistency
more than an exploit.

**Decision: accept it.** A self-declared adult (DOB or the over-25 tick, whoever
set it, including the member themselves) is trusted, and the possibility that a
minor lies to bypass the gate is an accepted residual risk. We do **not** add a
DOB-only self path, reject self-set `isDeclaredAdult`, require lead/staff
verification, or mandate guardian notification. Rationale: this is a small,
trust-based org; the gate's job is to stop the *accidental*/casual case (a minor
who simply lands on the enroll page), not to defeat deliberate misrepresentation,
which no self-service flow can. The trustworthy path (a lead enrolling the minor)
remains available for anyone who wants the stronger guarantee.

## Resolved — the self-gate and admin overrides

The original question was whether a confirmed board/sysadmin `override` — which
already bypasses every other soft limit — should also skip the known-adult
self-gate.

**It is moot, because overriding a limit for yourself is a conflict of
interest.** `lib/conflictOfInterest.ts` states the rule the rest of the app
follows: an actor may not decide their own household's case, and no role is
exempt. The enroll route never adopted it — `enforceLimits` keys only off
`override` and the actor's roles, never off *who the enrollment is for* — so a
sysadmin or board member can currently self-override past closed enrollment,
age bounds, members-only, and capacity. That was a pre-existing hole, closed
separately by #1463.

Once a conflicted actor can no longer reach the override exemption at all,
"inside `enforceLimits`" and "outside `enforceLimits`" are the same behaviour
for every case the self-gate can reach: the gate only fires when actor ==
target, and limits are then always enforced. So the gate lives **inside**
`enforceLimits` — one exemption rule, at one layer.

**Dependency satisfied.** #1463 landed first, so `enforceLimits` now reads
`!override || !isSysAdminOrBoard || isConflicted` — a conflicted actor, which a
self-enroller always is, can no longer reach the override exemption. The
self-gate therefore runs on every path it applies to, and its placement inside
`enforceLimits` is safe rather than merely equivalent.

## Known adult — DOB outranks the declared-adult flag

"Known adult" is 18+ by `dateOfBirth`, or `isDeclaredAdult` when there is no DOB
on file. Where both exist and disagree, the DOB wins: the flag stands in for a
missing DOB, it does not overrule one. (`checkProgramAge` already reads the flag
only on the no-DOB path; `isKnownAdult` matches it.) Unknown age is not an
adult — the helper fails closed.

## A youth never sees a payment situation

The governing rule, and it is a hard one: **a youth is never shown a payment
obligation, a payment action, or a payment status — their own or their
household's.** Not "disabled", not "explained" — absent.

What follows from it:

1. **No self-completion of a lead's checkout.** A pending enrollment created by
   a household lead is a payment the household owes, not one the youth may
   settle. The enroll route refuses a self-POST from a non-known-adult
   unconditionally — there is no "row already exists, so let them finish paying"
   carve-out.
2. **A youth's own pending row reads `Awaiting confirmation`.** The "Payment
   pending — select to finish payment" affordance is never shown to them. This
   is true whether or not the household ever pays, names no money, and puts the
   next action with someone else — so unlike a flat `Enrolled` it does not
   become a lie if the payment is abandoned. A youth cannot infer a checkout
   from it: pending could be capacity, review, or anything else. An ACTIVE row
   still reads `Enrolled`.
3. **The household summary is hidden from a youth entirely.** It names *other*
   members' pending payments; suppressing only the qualifier would still leak
   who owes what. The whole block goes.
4. **Payment actions are hidden.** "Pay on Shopify" and "Request a scholarship
   or payment plan" are not rendered for a youth.
5. **Withdrawal is not a youth action.** A youth may not `DELETE` their own
   enrollment — a lead does it. Beyond the consent symmetry, withdrawing a
   scholarship-held seat fires `withdrawAndReleaseHold` and a Shopify inventory
   release, which is a financial side effect a youth must not be able to
   trigger.
6. **Price stays public.** A program's cost is program information, on the card
   and the directory, and is not a payment *situation* — no obligation, no
   state, no action. A youth sees what a program costs; they never see that
   money is owed or a way to pay it.
7. **The enroll CTA states the rule, not the money.** A youth gets a disabled
   "a household lead must enroll you" — the same message on free and paid
   programs alike, because it names *who may act* rather than what it costs.
   One message, no price-dependent branch.

An **unverifiable-age** viewer is treated the opposite way throughout: they may
well be an adult, so they keep the `dob` reason that routes into the intake
panel. Hiding the enrollment surface from them would strand a brand-new adult
with no lead — the dead-end this design exists to avoid. Known minor → hide;
unverifiable → capture the age.

## The viewer signal — a session claim

Nothing client-side could previously tell a youth from an adult at render time,
so every suppression above needs one signal. **Decision: a JWT claim**, stamped
in `lib/authClaims.ts` beside the existing ones.

Why the claim rather than a per-response `viewerIsMember`-style flag:

- **It is not a stale token.** The `jwt` callback re-reads the Person from the
  DB on every subsequent request and re-stamps all claims, deliberately, so a
  revoked role cannot outlive its revocation (`session.updateAge` 15 minutes,
  `maxAge` 8 hours). Freshness is bounded by that window, not by re-login.
- **It costs no extra query.** Both callback branches use
  `findUnique({ where, include })` with no `select`, so every Person scalar —
  `dateOfBirth` and `isDeclaredAdult` included — is already loaded. The claim is
  a derived value over data already in hand.
- **Per-response scales as endpoints × signals.** Youth-gating alone would need
  `GET /api/programs/[id]` and `/api/programs/mine`, and each addition is a
  response-shape change to justify and a place to forget.
- **Per-response cannot gate shared chrome** — nav, badges, layout belong to no
  endpoint.
- **The codebase already made this choice.** Five role flags plus
  `householdLead`, `householdId`, `toolStatuses`, `programsLed`,
  `canAccessStaging`, and `denied` all live in the token for exactly this
  reason. A per-response flag would be the exception, not the safe path.

Two constraints that ride with it:

1. **Refresh on the remedy path.** Set-a-DOB-then-enroll is the one flow where
   the refresh window would be visibly wrong — the member fixes their age and
   the gate must open *now*, not up to 15 minutes later. The intake save calls
   `useSession().update()` to force a re-stamp before returning to the
   member-select.
2. **Stamp the derived band, never the date.** `dateOfBirth` is
   `@sensitivity:personal`; a derived `ageBand` in the token is fine, the raw
   date is not.

3. **A band, not a boolean.** "Not a known adult" covers a youth AND an
   unverifiable adult, and this design treats those oppositely — one boolean
   would hide the enrollment surface from the brand-new adult it exists to
   serve. `ageBand` is `adult | youth | unknown`, so the impossible pair cannot
   be represented.

`viewerIsMember` / `viewerMemberPricingEligible` stay as they are — an existing
exception, not the pattern to copy.

## Surface sweep

Every participant-reachable surface that renders payment state or a payment
action. Ops surfaces (`program-ops`, `finance-ops`, `membership-ops`) are
role-gated and out of a youth's reach, so they are not listed.

| Surface | What it shows | Action |
|---|---|---|
| `programs/[id]` member-select row | "Payment pending — select to finish payment" | Suppress (done) |
| `programs/[id]` household summary | "*Name* — Enrolled, payment pending", incl. other members | Hide the block for youth |
| `programs/[id]` primary CTA | "Continue enrollment" when the household owes | Falls back to the lead-required message |
| `programs/[id]` "Pay on Shopify" | Checkout action | Hide for youth |
| `programs/[id]` scholarship button | "Request a scholarship or payment plan" | Hide for youth |
| `my-activities/programs` | "Payment due" badge per enrollment | Reads `Awaiting confirmation` for youth |
| `POST request-payment-plan` | Authorises on `isSelf`, no age gate | Add the known-adult self-gate (server) |
| `DELETE participants` | Authorises self-removal, no age gate | Add the known-adult self-gate (server) |

Checked and clear: the programs directory, `my-household`, `my-programs`,
`FirstTimeIntakePanel`, and `attendance/current` (its "force checkout" is a
kiosk departure, not a payment).

**`membership/page.tsx` is a confirmed leak — checked, not closed.** The lead
gate is on the *start* path only: `state?.isLead` guards the "Start application"
button inside the `!state?.process` branch. Once a process exists the page falls
into the process branches, and none of them check `isLead`. The intake state is
household-scoped (`lib/membership/intake.ts` returns the household's `process`
to any member; `isLead` is the only per-user field), so a youth in a household
with an in-flight application lands straight in those branches.

At `PENDING_PAYMENT` a youth sees "Your annual household dues are $X" and a
"Pay here with Shopify →" button, and can click it. This is not UI-only:
`GET /api/membership/payment` is `withAuth({})` — any authenticated user — and
resolves the amount and checkout URL from the caller's household, so the data is
served to a youth by the API itself. The same unguarded branches also expose the
contract-signing and background-check tasks.

Not everything is open: `POST /api/membership/request-payment-plan` does check
lead membership and 403s a non-lead, and `renewal-status` returns
`renewalDue: false` to non-leads. The hole is the payment display and checkout,
not every membership action.

This is org-membership dues, a different domain from program enrollment — see
"Out of scope" below. Fixed separately in #1473.

## Open gaps

None. Every decision is recorded above; what remains is build work.

## Threshold

**18.** Guardian-consent line. Independent of a program's own `minAge`/`maxAge`
(which top out at 25 and gate *what age the program targets*, a separate axis
from *who may initiate*).

## Out of scope (deliberately)

- Minor with no active household lead — you said ignore.
- Waiver / consent capture at enroll time (`lastWaiverSign` exists, unused here).
- Any change to payment *mechanics*, capacity, or the Shopify path. Payment UI
  is now hidden from youth and withdrawal is gated, but no charge, hold, or
  inventory rule changes — the gated `DELETE` still runs the same
  `withdrawAndReleaseHold` when a lead performs it.
- **Org-membership dues.** Program enrollment is the subject here. The
  `membership/page.tsx` leak found by the sweep above was real, and was fixed
  separately in #1473.
- **Reconciling the missing-DOB posture across the app.** `leads.ts` reads an
  unknown DOB as adult, this design reads it as not-adult. Both are deliberate;
  making them agree is a decision, not a bug fix, and does not belong in this
  change.
- **Household-lead integrity.** A youth cannot hold `isHouseholdLead` —
  `addHouseholdLead` refuses, and every promotion path routes through it — so
  the lead-enrolls-a-household-member path this design relies on is sound. The
  remaining edges are issue #1471 — the route that wrote the flag directly is
  fixed in #1472, and what should bound leadless or otherwise semi-valid
  household states is still open there.

## Build shape

`isKnownAdult` and `ageBand` live in `lib/programAge.ts` next to
`checkProgramAge`, so the routes and the claim judge adulthood by one rule: the
routes use the predicate, the JWT carries the band.

Server (the enforcement; each is a refusal a direct POST cannot talk past):

- Enroll route `POST`: inside the limits-enforced block, after the age check,
  refuse a non-known-adult self-enroller — 403, with the minor and unverifiable
  messages above.
- Enroll route `DELETE`: refuse a non-known-adult self-removal.
- `request-payment-plan POST`: same self-gate.

Client (the absence), all keyed off the `ageBand` claim:

- Program page: the CTA reads the lead-required message and is disabled, the
  household payment summary is not rendered, and neither is "Pay on Shopify" or
  the scholarship button.
- Enroll page `enrollBlock`: on the viewer's own row, a known minor → the
  lead-required reason on a fresh enrollment and `Awaiting confirmation` on a
  pending one; an unverifiable age → the `dob` reason, which drops into the
  intake panel. Because a youth cannot open the member-select at all (the CTA is
  disabled), these row states are a defensive mirror of the route rather than a
  path a youth reaches.
- `my-activities/programs`: the payment badge reads `Awaiting confirmation`.

Tests — new cases: known minor self → refused; unverifiable-age self → refused
with the age-capture message, not the lead one; declared/DOB adult self →
allowed; a lead enrolling a minor → still allowed; a youth cannot withdraw
themselves; a youth sees the lead-required CTA, no payment surface, and still
sees the price, while an adult in the same household still gets the resume.

Tests — existing suites encoded the old rule and were re-pointed, since any
persona used for a non-age self-enroll or self-request now has to be a known
adult: `programAgeBounds` and `programAgeStartDate` (the "allow self-enrollment"
cases became lead-enrolls-child), `programsParticipantsAPI` (drop-out split into
youth-refused and adult-allowed), `programsHouseholdEnrollment`,
`programPaymentPlansAPI`, and `enrollmentStateOracle`, plus the enroll page
suite and the `rtl` session helper (which now exposes `update`).

`programAgeBounds` also built its boundary DOBs from local date parts while
`calculateAge` reads UTC, so the "turns 14 tomorrow" persona read as 14 after
~19:00 local and that test failed on its own, independent of this change. Those
fixtures are now built with `Date.UTC`.
