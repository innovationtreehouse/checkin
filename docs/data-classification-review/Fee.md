# Data Classification Review — Fee

> Source: `prisma/schema.prisma` lines 311–325 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

A line-item fee tied to a Program (e.g. materials fee, deposit). Prices in cents for member vs non-member.

## Fields

| Field | Type | Current tier | OK? | Notes |
|---|---|---|---|---|
| id | Int (PK) | public | | |
| programId | Int | public | | |
| name | String | public | | |
| nonMemberPrice | Int | public | | |
| memberPrice | Int | public | | |

## Tier counts

public: 5 · pii: 0 · personal: 0 · internal: 0 · secret: 0

## Review notes

_Free-form observations or proposed changes._
