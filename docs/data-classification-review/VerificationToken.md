# Data Classification Review — VerificationToken

> Source: `prisma/schema.prisma` lines 487–496 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

**Status:** ✅ Reviewed — confirmed as-is. No schema changes.

NextAuth email-verification / magic-link token. Compound unique on `(identifier, token)`.

## Fields

| Field | Type | Tier | OK? | Notes |
|---|---|---|---|---|
| identifier | String | internal | ✓ | email-or-similar verification target |
| token | String @unique | secret | ✓ | bearer credential |
| expires | DateTime | internal | ✓ | |

## Tier counts

public: 0 · pii: 0 · personal: 0 · internal: 2 · secret: 1

## Decision log (2026-05-14)

Confirmed at current tiers — `token` at `secret` (bearer credential), `identifier` + `expires` at `internal`. No FK fields here (compound unique on natural key, not a Participant.id FK).

**No route changes:** consumed by NextAuth, never returned by application routes.
