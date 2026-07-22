# Household-Lead model: one stored fact, not two

**Status: SHIPPED (2026-07-05) as option (a1).** Leadership is
`Person.isHouseholdLead Boolean @default(false)`; the led household is by
definition `Person.householdId`. Delivered as a zero-downtime expand-contract
(expand #917: additive column + backfill + reader cutover; contract PR: drop
the `HouseholdLead` table — separate releases, per
DEPLOY_MIGRATION_ORDER_OF_OPERATIONS.md). Both migrations have since been
coalesced into the `20260711173200_coalesced_baseline`. Every gate is
greppable via `isHouseholdLead`. **No open items.**

## The problem this solved

A person's household was stored twice: `Person.householdId` (the household of
record) and a copy on each `HouseholdLead` row. Leadership was decided by
demanding the two agree — an auth gate resting on an equality that no FK,
CHECK, or trigger enforced; each write path independently remembered to keep
it true. The investigation audited every write path and found **no live path
could produce a mismatch** — a latent structural hazard, not an active bug —
which is what justified the paced expand-contract rather than an emergency
fix. The exposure was the *next* write path (or import, or manual edit)
forgetting a convention that nothing checked.

## Decisions and constraints (code-independent — the reasons to not undo this)

**External / cross-household leads are deliberately unsupported.** A lead is
always a member of their own household. At decision time no consumer treated
a lead-of-another-household as valid — such a row was invisible to every
gate, a feature no code could observe. This is THE load-bearing decision:
reopening it flips the design to option (c) below, which means re-scoping
every lead gate per household and introducing over-grant risk where none
exists today (guardian in another household or org-appointed steward would
be the motivating cases; neither existed).

**Boolean, not a join table.** A join table earns its keep only with
many-to-many (ruled out above) or per-edge columns (promoted-at, promoted-by,
a role enum — none existed, YAGNI). One household id plus one bit is exactly
a flag on Person. *Reversal trigger:* if per-edge lead data is ever genuinely
needed, a1's boolean is what gets unwound — expect that migration, don't
bolt columns onto Person.

**No DB trigger (why option (b) lost).** A plain `CHECK` cannot express the
old invariant (it would need to read the `Person` row, which Postgres CHECK
forbids), so enforcement meant a trigger — security-relevant logic invisible
to `tsc` and to every TS reader of the codebase. Rejected as a norm, not just
here. App-level funneling was merely the existing convention written down; it
could not stop imports or manual edits.

**Under-grant vs over-grant asymmetry (why the old bug was tolerable and (c)
is not).** The equality-style gate failed *safe*: a divergent row made a real
lead look like a non-lead — a lockout, filed as a support ticket. The
safety-adjacent edge was background-check stamping silently skipping a
mismatched guardian. Existence-style gates ((c)'s shape) fail *open*: get one
gate's re-scoping wrong and a lead of household A edits household B. Fail-safe
beats fail-open for an authz primitive; that asymmetry is the standing reason
(c) stays human-gated.

## Rejected options (tombstones)

- **(a2) drop the copied column, keep a one-column join table:** isomorphic to
  the boolean with an extra join — acceptable as a staging migration, never a
  resting state. a1 was landed directly instead.
- **(b) keep the join, enforce the equality at write:** see the no-trigger
  norm above. Also the option with the worst surprise profile (a trigger
  silently failing an unrelated `Person.householdId` update in prod).
- **(c) bless external leads, rescope every gate:** only correct if the
  external-lead decision reverses; the largest and riskiest security surface.
  Not pursued speculatively.
