# Data Classification Review — ProgramParticipant

> Source: `prisma/schema.prisma` lines 293–309 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

Join table: which Participants are enrolled in which Programs. `status` is `PENDING` (awaiting confirmation) or `ACTIVE`. Tracks payment-plan requests. Compound primary key `(programId, participantId)`.

## Fields

| Field | Type | Current tier | OK? | Notes |
|---|---|---|---|---|
| programId | Int | public | | |
| participantId | Int | public | | |
| status | ProgramParticipantStatus | public | | |
| paymentPlanRequested | Boolean | personal | | |
| pendingSince | DateTime? | internal | | |

## Tier counts

public: 3 · pii: 0 · personal: 1 · internal: 1 · secret: 0

## Review notes

_Free-form observations or proposed changes._
