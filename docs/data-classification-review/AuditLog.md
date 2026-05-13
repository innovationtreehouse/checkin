# Data Classification Review — AuditLog

> Source: `prisma/schema.prisma` lines 423–442 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

Append-only log of admin-significant actions. Records actor, action (`CREATE`/`EDIT`/`DELETE`/`BECOME_ADMIN`), affected table + entity, plus old/new JSON snapshots.

## Fields

| Field | Type | Current tier | OK? | Notes |
|---|---|---|---|---|
| id | Int (PK) | internal | | |
| time | DateTime | internal | | |
| actorId | Int | internal | | |
| action | AuditAction | internal | | |
| tableName | String | internal | | |
| affectedEntityId | Int | internal | | |
| secondaryAffectedEntity | Int? | internal | | |
| oldData | Json? | internal | | |
| newData | Json? | internal | | |

## Tier counts

public: 0 · pii: 0 · personal: 0 · internal: 9 · secret: 0

## Review notes

_Free-form observations or proposed changes._

> Note: `oldData` / `newData` JSON snapshots can contain values from *any* tier of the affected table (PII, personal, secret-adjacent). The classification on these columns sets a floor — the registry view must still gate access correctly for audit consumers.
