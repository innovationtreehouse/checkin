# Data Classification Review — AuditLog

> Source: `prisma/schema.prisma` lines 423–442 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

**Status:** ✅ Reviewed — three entity-id FKs aligned to `pii`; remaining fields confirmed at `internal`.

Append-only log of admin-significant actions. Records actor, action (`CREATE`/`EDIT`/`DELETE`/`BECOME_ADMIN`), affected table + entity, plus old/new JSON snapshots.

## Fields

| Field | Type | Tier | OK? | Notes |
|---|---|---|---|---|
| id | Int (PK) | internal | ✓ | audit-row index |
| time | DateTime | internal | ✓ | event timestamp |
| actorId | Int | pii | ↓ | was internal — aligned to the `Participant.id` propagation tier (consistent with the [RawBadgeEvent](RawBadgeEvent.md) fix) |
| action | AuditAction | internal | ✓ | CREATE / EDIT / DELETE / BECOME_ADMIN |
| tableName | String | internal | ✓ | affected table name |
| affectedEntityId | Int | pii | ↓ | was internal — overloaded FK (usually `Participant.id`), aligned to pii |
| secondaryAffectedEntity | Int? | pii | ↓ | was internal — overloaded FK, aligned to pii |
| oldData | Json? | internal | ✓ | full-row JSON snapshot before change |
| newData | Json? | internal | ✓ | full-row JSON snapshot after change |

## Tier counts

public: 0 · pii: 3 · personal: 0 · internal: 6 · secret: 0

## Decision log (2026-05-14)

Three entity-id FKs (`actorId`, `affectedEntityId`, `secondaryAffectedEntity`) lifted to `pii` to match the `Participant.id` propagation pattern. Previously at `internal` was over-tightening — internal already implies admin-only access via existing views, so the pii tier choice is the consistent convention without functional change.

JSON snapshot columns (`oldData`, `newData`) confirmed at `internal`. Note that these can contain values from any tier of the affected table (PII, personal, etc.) — the column-level classification is a floor; the route view must still gate access correctly for any future audit-log-reader endpoint.

**No FK propagation up:** AuditLog is downstream of every other model.

**No route changes:** AuditLog is currently a write-only sink. Every reference in `src/app/api/` is a `prisma.auditLog.create()` call from a handler emitting an audit entry; no route returns AuditLog rows to a client today.

## Consequences worth tracking

- **Future audit-log-reader UI** — when a forensic / audit-viewer endpoint is built, its view must include `everyones:pii` + `everyones:internal` to surface the FK columns alongside the descriptive columns. If `oldData` / `newData` need redaction beyond the column-level floor, the handler must do row-aware redaction (the stripper doesn't introspect JSON contents).

## Pending consistency items

None.
