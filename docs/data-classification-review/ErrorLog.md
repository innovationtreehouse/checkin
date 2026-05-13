# Data Classification Review — ErrorLog

> Source: `prisma/schema.prisma` lines 498–511 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

Captured server-side errors — route, message, stack, plus a JSON context blob for the surrounding request state.

## Fields

| Field | Type | Current tier | OK? | Notes |
|---|---|---|---|---|
| id | Int (PK) | internal | | |
| createdAt | DateTime | internal | | |
| route | String? | internal | | |
| message | String | internal | | |
| stack | String? | internal | | |
| context | Json? | internal | | |

## Tier counts

public: 0 · pii: 0 · personal: 0 · internal: 6 · secret: 0

## Review notes

_Free-form observations or proposed changes._

> Note: `context` JSON can carry request bodies / params that included PII or personal data. Like `AuditLog.{old,new}Data`, the classification on this column is a floor, not a guarantee.
