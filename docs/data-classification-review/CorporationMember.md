# Data Classification Review — CorporationMember

> Source: `prisma/schema.prisma` lines 223–233 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

Join table: which Participants get access through which Corporation's membership. Compound primary key `(corporationId, participantId)`.

## Fields

| Field | Type | Current tier | OK? | Notes |
|---|---|---|---|---|
| corporationId | Int | public | | |
| participantId | Int | public | | |

## Tier counts

public: 2 · pii: 0 · personal: 0 · internal: 0 · secret: 0

## Review notes

_Free-form observations or proposed changes._
