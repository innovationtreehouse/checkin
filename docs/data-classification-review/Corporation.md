# Data Classification Review — Corporation

> Source: `prisma/schema.prisma` lines 198–209 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

An organization that holds a corporate membership. Has leads (who manage it) and members (who get access via the corp membership).

## Fields

| Field | Type | Current tier | OK? | Notes |
|---|---|---|---|---|
| id | Int (PK) | public | | |
| primaryEmail | String? | pii | | |
| address | String? | personal | | |

## Tier counts

public: 1 · pii: 1 · personal: 1 · internal: 0 · secret: 0

## Review notes

_Free-form observations or proposed changes._
