# Data Classification Review — RawBadgeEvent

> Source: `prisma/schema.prisma` lines 390–403 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

**Status:** ✅ Reviewed — descriptive fields tightened to `internal`, participantId loosened to `pii` (FK consistency).

Raw badge-tap stream from the door reader, before pairing into `Visit` rows. Index on `(participantId, time)` is used for double-tap detection in `/api/scan`.

## Fields

| Field | Type | Tier | OK? | Notes |
|---|---|---|---|---|
| id | Int (PK) | internal | ✓ | confirmed — opaque counter for internal scan-correlation |
| participantId | Int | pii | ↓ | was `internal` (stricter than the standard `Participant.id` propagation tier of `pii`) — aligned to `pii` for FK consistency |
| time | DateTime | internal | ↑ | was personal — badge-tap time is presence data, admin-only |
| location | String? | internal | ↑ | was personal — badge-tap location is presence data, admin-only |

## Tier counts

public: 0 · pii: 1 · personal: 0 · internal: 3 · secret: 0

## Decision log (2026-05-14)

The previous tier mix was inconsistent: id+participantId at internal, time+location at personal. The descriptive fields (when + where a person tapped) are actually more identifying than the row's index id, so the levels were upside-down.

- `participantId` aligned to `pii` (the standard tier for `Participant.id` FKs). Previously sitting at `internal` was over-tightening that didn't add real protection — any caller with internal access already covers lower tiers.
- `time` and `location` tightened to `internal` — raw scan data is admin/staff source-of-truth, not member-visible.

**No FK propagation needed:** participantId moves *toward* the propagation tier from a stricter starting point, so no upstream effect.

**No route changes:** RawBadgeEvent isn't surfaced on any non-admin route today. The `/api/scan` flow reads RawBadgeEvent rows server-side for double-tap detection but doesn't ship them to clients.

## Consequences worth tracking

None — RawBadgeEvent is fully server-side.
