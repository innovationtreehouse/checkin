# Data Classification Review — VerificationToken

> Source: `prisma/schema.prisma` lines 487–496 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

NextAuth email-verification / magic-link token. Compound unique on `(identifier, token)`.

## Fields

| Field | Type | Current tier | OK? | Notes |
|---|---|---|---|---|
| identifier | String | internal | | |
| token | String @unique | secret | | |
| expires | DateTime | internal | | |

## Tier counts

public: 0 · pii: 0 · personal: 0 · internal: 2 · secret: 1

## Review notes

_Free-form observations or proposed changes._
