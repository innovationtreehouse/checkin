# Data Classification Review — Account

> Source: `prisma/schema.prisma` lines 444–473 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

NextAuth OAuth account record — one row per (provider, providerAccountId). Holds the OAuth refresh/access/id tokens. Cascades on Participant delete.

## Fields

| Field | Type | Current tier | OK? | Notes |
|---|---|---|---|---|
| id | String (PK) | internal | | |
| userId | Int (→ Participant) | internal | | |
| type | String | internal | | |
| provider | String | internal | | |
| providerAccountId | String | internal | | |
| refresh_token | String? | secret | | |
| access_token | String? | secret | | |
| expires_at | Int? | internal | | |
| token_type | String? | internal | | |
| scope | String? | internal | | |
| id_token | String? | secret | | |
| session_state | String? | internal | | |

## Tier counts

public: 0 · pii: 0 · personal: 0 · internal: 9 · secret: 3

## Review notes

_Free-form observations or proposed changes._
