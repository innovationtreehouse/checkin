# Data Classification Review — Session

> Source: `prisma/schema.prisma` lines 475–485 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

NextAuth server-side session record. `sessionToken` is the bearer for cookie auth. Cascades on Participant delete.

## Fields

| Field | Type | Current tier | OK? | Notes |
|---|---|---|---|---|
| id | String (PK) | internal | | |
| sessionToken | String @unique | secret | | |
| userId | Int (→ Participant) | internal | | |
| expires | DateTime | internal | | |

## Tier counts

public: 0 · pii: 0 · personal: 0 · internal: 3 · secret: 1

## Review notes

_Free-form observations or proposed changes._
