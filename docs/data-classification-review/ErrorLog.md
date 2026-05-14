# Data Classification Review — ErrorLog

> Source: `prisma/schema.prisma` lines 498–511 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

**Status:** ✅ Reviewed — confirmed all at `internal`. No schema changes.

Captured server-side errors — route, message, stack, plus a JSON context blob for the surrounding request state.

## Fields

| Field | Type | Tier | OK? | Notes |
|---|---|---|---|---|
| id | Int (PK) | internal | ✓ | log-row index |
| createdAt | DateTime | internal | ✓ | |
| route | String? | internal | ✓ | |
| message | String | internal | ✓ | |
| stack | String? | internal | ✓ | |
| context | Json? | internal | ✓ | may carry request bodies / params — column tier is a floor; route view enforces ceiling |

## Tier counts

public: 0 · pii: 0 · personal: 0 · internal: 6 · secret: 0

## Decision log (2026-05-14)

Confirmed at internal across all fields. Same forcing-function philosophy as `AuditLog.{old,new}Data`: the `context` JSON column can contain values from any tier of the underlying request (PII, personal, etc.) — the column-level classification is a *floor*; any future error-log-reader endpoint must opt in via internal-grant in its view, and the handler must do any row-aware redaction beyond the column-level floor (the stripper doesn't introspect JSON contents).

**No route changes:** ErrorLog is a write-only sink — handlers call `logBackendError(...)` to insert rows; no route returns ErrorLog rows.

## Consequences worth tracking

None. Future forensic UIs would need :internal grants and possibly handler-level JSON redaction.
