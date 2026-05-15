# Data Classification Review — RSVP

> Source: `prisma/schema.prisma` lines 376–388 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

**Status:** ✅ Reviewed — `status` softened to `personal`. Other fields propagated.

A participant's response to an Event: `ATTENDING`, `NOT_ATTENDING`, `NO_RESPONSE`, or `MAYBE`. Compound primary key `(eventId, participantId)`.

## Fields

| Field | Type | Tier | OK? | Notes |
|---|---|---|---|---|
| eventId | Int | public | ✓ | propagated from `Event.id` (public, confirmed) |
| participantId | Int | pii | ✓ | propagated from `Participant.id` during the [Participant](Participant.md) review |
| status | RSVPStatus | personal | ↑ | was public — keeps row-level gating via participantId (pii) but additionally requires personal-tier visibility |

## Tier counts

public: 1 · pii: 1 · personal: 1 · internal: 0 · secret: 0

## Decision log (2026-05-14)

`status` tightened from public → personal. Different direction from [ProgramParticipant.status](ProgramParticipant.md) (which went to internal): RSVPs are casual event responses meant to be visible within their gated scope — self and event lead mentors specifically — without needing admin-tier access.

**No route changes:** every RSVP-surfacing route already grants the right `*:personal` token:
- `PATCH /api/events/[id]/rsvp`: authenticated → `their_own:personal` ✓
- `GET /api/events/mine`: authenticated → `their_own:personal`, lead mentor/core volunteer → `their_program_participants:personal` ✓
- `GET /api/events/[id]`: lead mentor → `their_program_participants:personal`, core volunteer → `their_program_participants:personal`, authenticated → `their_own:personal` ✓
- Admin/merge routes: full internal coverage ✓

## Consequences worth tracking

None — every existing view already covers the new tier.
