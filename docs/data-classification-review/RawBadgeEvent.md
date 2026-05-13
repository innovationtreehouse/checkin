# Data Classification Review — RawBadgeEvent

> Source: `prisma/schema.prisma` lines 390–403 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

Raw badge-tap stream from the door reader, before pairing into `Visit` rows. Index on `(participantId, time)` is used for double-tap detection in `/api/scan`.

## Fields

| Field | Type | Current tier | OK? | Notes |
|---|---|---|---|---|
| id | Int (PK) | internal | | |
| participantId | Int | internal | | |
| time | DateTime | personal | | |
| location | String? | personal | | |

## Tier counts

public: 0 · pii: 0 · personal: 2 · internal: 2 · secret: 0

## Review notes

_Free-form observations or proposed changes._
