# Data Classification Review — ToolStatus

> Source: `prisma/schema.prisma` lines 128–140 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

Per-participant certification level on a tool: `BASIC`, `DOF`, `CERTIFIED`, `MAY_CERTIFY_OTHERS`. Compound primary key `(userId, toolId)`.

## Fields

| Field | Type | Current tier | OK? | Notes |
|---|---|---|---|---|
| userId | Int | public | | |
| toolId | Int | public | | |
| level | ToolLevel | internal | | |

## Tier counts

public: 2 · pii: 0 · personal: 0 · internal: 1 · secret: 0

## Review notes

_Free-form observations or proposed changes._
