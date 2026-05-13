# Data Classification Review — ProgramVolunteer

> Source: `prisma/schema.prisma` lines 279–291 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

Join table: which Participants are volunteering on which Programs. `isCore` distinguishes core volunteers (broader access to program data) from regular volunteers. Compound primary key `(programId, participantId)`.

## Fields

| Field | Type | Current tier | OK? | Notes |
|---|---|---|---|---|
| programId | Int | public | | |
| participantId | Int | public | | |
| isCore | Boolean | internal | | |

## Tier counts

public: 2 · pii: 0 · personal: 0 · internal: 1 · secret: 0

## Review notes

_Free-form observations or proposed changes._
