# Data Classification Review — RSVP

> Source: `prisma/schema.prisma` lines 376–388 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

A participant's response to an Event: `ATTENDING`, `NOT_ATTENDING`, `NO_RESPONSE`, or `MAYBE`. Compound primary key `(eventId, participantId)`.

## Fields

| Field | Type | Current tier | OK? | Notes |
|---|---|---|---|---|
| eventId | Int | public | | |
| participantId | Int | public | | |
| status | RSVPStatus | public | | |

## Tier counts

public: 3 · pii: 0 · personal: 0 · internal: 0 · secret: 0

## Review notes

_Free-form observations or proposed changes._
