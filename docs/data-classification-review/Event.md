# Data Classification Review — Event

> Source: `prisma/schema.prisma` lines 347–374 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

**Status:** ✅ Reviewed — all fields confirmed at current tiers. No schema changes.

A single scheduled event — optionally part of a Program, optionally part of a recurring group. Carries attendance-confirmation metadata (who confirmed, when, whether the wrap-up email went out).

## Fields

| Field | Type | Tier | OK? | Notes |
|---|---|---|---|---|
| id | Int (PK) | public | ✓ | catalog index |
| programId | Int? | public | ✓ | propagated from `Program.id` (public, confirmed) |
| name | String | public | ✓ | event name in calendar |
| start | DateTime | public | ✓ | event start |
| end | DateTime | public | ✓ | event end |
| description | String? | public | ✓ | event description |
| attendanceConfirmedAt | DateTime? | internal | ✓ | staff workflow timestamp |
| attendanceConfirmedById | Int? | internal | ✓ | staff workflow — left at internal during the Participant review (it's a Participant.id FK but was already internal, so no propagation needed) |
| postEventEmailSent | Boolean | internal | ✓ | operational flag |
| recurringGroupId | String? | public | ✓ | scheduling group key |

## Tier counts

public: 7 · pii: 0 · personal: 0 · internal: 3 · secret: 0

## Decision log (2026-05-14)

Same shape as [Program](Program.md): public catalog data + internal staff workflow. No tightening makes sense — events are listed publicly, attendance-confirmation workflow is staff-only.

No FK propagation, no route changes, no test updates.

## Consequences worth tracking

None.
