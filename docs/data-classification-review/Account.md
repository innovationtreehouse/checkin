# Data Classification Review — Account

> Source: `prisma/schema.prisma` lines 444–473 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

**Status:** ✅ Reviewed — `userId` aligned to `pii`; remaining fields confirmed.

NextAuth OAuth account record — one row per (provider, providerAccountId). Holds the OAuth refresh/access/id tokens. Cascades on Participant delete.

## Fields

| Field | Type | Tier | OK? | Notes |
|---|---|---|---|---|
| id | String (PK) | internal | ✓ | cuid; opaque internal |
| userId | Int (→ Participant) | pii | ↓ | was internal — aligned to the `Participant.id` propagation tier (same fix as RawBadgeEvent / AuditLog) |
| type | String | internal | ✓ | oauth / email / etc. |
| provider | String | internal | ✓ | "google" etc. |
| providerAccountId | String | internal | ✓ | external account id (Google sub etc.) |
| refresh_token | String? | secret | ✓ | bearer credential |
| access_token | String? | secret | ✓ | bearer credential |
| expires_at | Int? | internal | ✓ | |
| token_type | String? | internal | ✓ | |
| scope | String? | internal | ✓ | |
| id_token | String? | secret | ✓ | bearer credential |
| session_state | String? | internal | ✓ | |

## Tier counts

public: 0 · pii: 1 · personal: 0 · internal: 8 · secret: 3

## Decision log (2026-05-14)

`userId` lifted from `internal` to `pii` to match the `Participant.id` FK propagation convention (consistent with [RawBadgeEvent](RawBadgeEvent.md) and [AuditLog](AuditLog.md)). OAuth bearer tokens stay at `secret`. Structural fields stay at `internal`.

**No route changes:** Account is not surfaced on any route — it's accessed directly by NextAuth.
