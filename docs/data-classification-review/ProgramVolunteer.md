# Data Classification Review — ProgramVolunteer

> Source: `prisma/schema.prisma` lines 279–291 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

**Status:** ✅ Reviewed — all fields confirmed at current tiers. No schema changes.

Join table: which Participants are volunteering on which Programs. `isCore` distinguishes core volunteers (broader access to program data) from regular volunteers. Compound primary key `(programId, participantId)`.

## Fields

| Field | Type | Tier | OK? | Notes |
|---|---|---|---|---|
| programId | Int | public | ✓ | propagated from `Program.id` (public, confirmed) |
| participantId | Int | pii | ✓ | propagated from `Participant.id` during the [Participant](Participant.md) review |
| isCore | Boolean | internal | ✓ | staff-level metadata — core volunteers get `their_program_participants` scope; non-core/non-admin callers don't see the flag |

## Tier counts

public: 1 · pii: 1 · personal: 0 · internal: 1 · secret: 0

## Decision log (2026-05-14)

All three fields confirmed. The composite "X is a (core?) volunteer on program Y" is gated at the stricter (pii) tier via participantId; isCore is additionally gated at internal so only admins/staff and the core volunteers themselves (via their_program_participants:internal in routes that grant it) can read the core distinction.

No FK propagation, no route changes, no test updates.

## Consequences worth tracking

None.
