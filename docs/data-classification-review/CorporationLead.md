# Data Classification Review — CorporationLead

> Source: `prisma/schema.prisma` lines 211–221 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

Join table: which Participants are leads (managers) of which Corporations. Compound primary key `(corporationId, participantId)`.

## Fields

| Field | Type | Current tier | OK? | Notes |
|---|---|---|---|---|
| corporationId | Int | public | | |
| participantId | Int | public | | |

## Tier counts

public: 2 · pii: 0 · personal: 0 · internal: 0 · secret: 0

## Review notes

_Free-form observations or proposed changes._
