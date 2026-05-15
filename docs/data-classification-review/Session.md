# Data Classification Review — Session

> Source: `prisma/schema.prisma` lines 475–485 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

**Status:** ✅ Reviewed — `userId` aligned to `pii`; remaining fields confirmed.

NextAuth server-side session record. `sessionToken` is the bearer for cookie auth. Cascades on Participant delete.

## Fields

| Field | Type | Tier | OK? | Notes |
|---|---|---|---|---|
| id | String (PK) | internal | ✓ | cuid; opaque internal |
| sessionToken | String @unique | secret | ✓ | bearer credential |
| userId | Int (→ Participant) | pii | ↓ | was internal — aligned to the `Participant.id` propagation tier |
| expires | DateTime | internal | ✓ | |

## Tier counts

public: 0 · pii: 1 · personal: 0 · internal: 2 · secret: 1

## Decision log (2026-05-14)

`userId` lifted from `internal` to `pii` to match the `Participant.id` FK propagation convention. `sessionToken` stays at `secret`. Structural fields stay at `internal`.

**No route changes:** Session is accessed by NextAuth, never returned by application routes.
