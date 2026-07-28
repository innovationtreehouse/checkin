# Youth enrollment rules (issue #167)

**Status: DESIGN — not built.** Policy + rationale only. No code here; the
mechanics land in the implementation when we agree to build.

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

**Decision: accept it.** A self-declared adult (DOB or the over-25 tick, whoever
set it, including the member themselves) is trusted, and the possibility that a
minor lies to bypass the gate is an accepted residual risk. We do **not** add a
DOB-only self path, reject self-set `isDeclaredAdult`, require lead/staff
verification, or mandate guardian notification. Rationale: this is a small,
trust-based org; the gate's job is to stop the *accidental*/casual case (a minor
who simply lands on the enroll page), not to defeat deliberate misrepresentation,
which no self-service flow can. The trustworthy path (a lead enrolling the minor)
remains available for anyone who wants the stronger guarantee.

## Open question — does the self-gate apply to admin overrides?

A confirmed board/sysadmin `override` already deliberately bypasses every soft
limit (closed enrollment, age, capacity) — that's an existing, tested intent
lock. Placing the known-adult **self**-gate *before* that override path would
also block an admin who self-enrolls-with-override and happens to have no DOB.

Proposed resolution: the self-gate is about ordinary self-enrollers, so it
should live under the **same override exemption** as the other soft limits — a
confirmed admin override skips it too. (Concretely: the gate runs only when
limits are being enforced, not on the admin-override path.) **Needs your
sign-off** before implementation.

## Threshold

**18.** Guardian-consent line. Independent of a program's own `minAge`/`maxAge`
(which top out at 25 and gate *what age the program targets*, a separate axis
from *who may initiate*).

## Out of scope (deliberately)

- Minor with no active household lead — you said ignore.
- Waiver / consent capture at enroll time (`lastWaiverSign` exists, unused here).
- Any change to payment, capacity, or the Shopify path.

## If/when we build it (sketch, not a spec)

- Enroll route: after the existing authz check and under the same
  limits-enforced condition as the age check, refuse a non-known-adult
  self-enroller with the two messages above.
- Enroll page `enrollBlock`: on the viewer's own row, a known-minor → the
  lead-required reason; an unverifiable age → the existing `dob` reason, which
  already drops into the intake panel.
- Tests: known minor self → refused; unverifiable-age self → refused; declared/
  DOB adult self → allowed; admin override self (per the open question) →
  allowed. Personas used elsewhere for non-age self-enroll must be known adults.
