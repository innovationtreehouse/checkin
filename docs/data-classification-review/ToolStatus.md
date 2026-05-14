# Data Classification Review — ToolStatus

> Source: `prisma/schema.prisma` lines 128–140 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

**Status:** ✅ Reviewed — `toolId` propagated to `internal`; `userId` and `level` confirmed.

Per-participant certification level on a tool: `BASIC`, `DOF`, `CERTIFIED`, `MAY_CERTIFY_OTHERS`. Compound primary key `(userId, toolId)`.

## Fields

| Field | Type | Tier | OK? | Notes |
|---|---|---|---|---|
| userId | Int | pii | ✓ | propagated from `Participant.id` during the [Participant](Participant.md) review |
| toolId | Int | internal | ↑ | was public — propagated from `Tool.id` (now internal, see [Tool.md](Tool.md)) |
| level | ToolLevel | internal | ✓ | confirmed — certification level is staff-tracked data |

## Tier counts

public: 0 · pii: 1 · personal: 0 · internal: 2 · secret: 0

## Decision log (2026-05-14)

`toolId` propagated to `internal` to match Tool.id. `userId` and `level` confirmed at their existing tiers.

The composite ("participant X is certified at level Y on tool Z") requires both userId (pii) AND toolId/level (internal) visibility — effectively admin/staff only.

**No route changes.** The kiosk path uses `dangerously_allow_all_data_access`; staff routes have full internal coverage; non-staff routes don't surface ToolStatus today.

## Consequences worth tracking

None directly — flows through the same routes affected by the [Tool.md](Tool.md) consequences.
