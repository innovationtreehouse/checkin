# Data Classification Review — HouseholdLead

> Source: `prisma/schema.prisma` lines 159–169 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

**Status:** ✅ Reviewed — confirmed as propagated. No schema changes in this review.

Join table: which Participants are leads (managers) of which Households. Compound primary key `(householdId, participantId)`.

## Fields

| Field | Type | Tier | OK? | Notes |
|---|---|---|---|---|
| householdId | Int | personal | ✓ | propagated from `Household.id` during the [Household](Household.md) review |
| participantId | Int | pii | ✓ | propagated from `Participant.id` during the [Participant](Participant.md) review |

## Tier counts

public: 0 · pii: 1 · personal: 1 · internal: 0 · secret: 0

## Decision log (2026-05-14)

Both fields were tightened transitively by upstream reviews — no fresh schema changes needed here. The join-row composite "X leads household Y" is gated at the stricter (pii) tier: to learn that participant X leads household Y, the caller needs participant-id visibility at pii, which already implies the right scope (their_own / their_households / their_program_participants / admin).

No FK propagation, no route changes, no test updates.

## Consequences worth tracking

None — propagated tier set was already in effect after the Participant + Household reviews. This review just records the confirmation.
