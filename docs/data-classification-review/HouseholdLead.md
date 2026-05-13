# Data Classification Review — HouseholdLead

> Source: `prisma/schema.prisma` lines 159–169 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

Join table: which Participants are leads (managers) of which Households. Compound primary key `(householdId, participantId)`.

## Fields

| Field | Type | Current tier | OK? | Notes |
|---|---|---|---|---|
| householdId | Int | public | | |
| participantId | Int | public | | |

## Tier counts

public: 2 · pii: 0 · personal: 0 · internal: 0 · secret: 0

## Review notes

_Free-form observations or proposed changes._
