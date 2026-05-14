# Data Classification Review — CorporationMember

> Source: `prisma/schema.prisma` lines 223–233 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

**Status:** ✅ Reviewed — confirmed as propagated. No schema changes in this review.

Join table: which Participants get access through which Corporation's membership. Compound primary key `(corporationId, participantId)`.

## Fields

| Field | Type | Tier | OK? | Notes |
|---|---|---|---|---|
| corporationId | Int | public | ✓ | propagated from `Corporation.id` (confirmed public in the [Corporation](Corporation.md) review) |
| participantId | Int | pii | ✓ | propagated from `Participant.id` during the [Participant](Participant.md) review |

## Tier counts

public: 1 · pii: 1 · personal: 0 · internal: 0 · secret: 0

## Decision log (2026-05-14)

Both fields confirmed at their propagated tiers — same shape as [HouseholdLead](HouseholdLead.md) and [CorporationLead](CorporationLead.md). The join-row composite "participant X is a member through corporation Y" is gated at the stricter (pii) tier: to learn the relationship you need participant-id visibility at pii, which already implies the right scope.

No FK propagation, no route changes, no test updates. Corporation is unused in the registry today (see [Corporation](Corporation.md)) so there's nothing surface-level to track.

## Consequences worth tracking

None.
