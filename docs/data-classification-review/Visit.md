# Data Classification Review — Visit

> Source: `prisma/schema.prisma` lines 405–421 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

A check-in/check-out record for a participant. Optionally associated with an Event. `departed` is null while the visitor is still in the building. Index on `(participantId, departed)` powers the active-visitor lookup in `/api/scan`.

## Fields

| Field | Type | Current tier | OK? | Notes |
|---|---|---|---|---|
| id | Int (PK) | public | | |
| participantId | Int | public | | |
| arrived | DateTime | personal | | |
| departed | DateTime? | personal | | |
| associatedEventId | Int? | public | | |

## Tier counts

public: 3 · pii: 0 · personal: 2 · internal: 0 · secret: 0

## Review notes

_Free-form observations or proposed changes._
