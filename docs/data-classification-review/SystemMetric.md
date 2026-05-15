# Data Classification Review — SystemMetric

> Source: `prisma/schema.prisma` lines 513–522 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

**Status:** ✅ Reviewed — confirmed all at `internal`. No schema changes.

Time-series application metrics emitted by the server (counters, latencies, etc.).

## Fields

| Field | Type | Tier | OK? | Notes |
|---|---|---|---|---|
| id | Int (PK) | internal | ✓ | |
| timestamp | DateTime | internal | ✓ | |
| metric | String | internal | ✓ | metric key (e.g. "scan.latency.p50") |
| value | Float | internal | ✓ | numeric value |

## Tier counts

public: 0 · pii: 0 · personal: 0 · internal: 4 · secret: 0

## Decision log (2026-05-14)

Confirmed at internal. SystemMetric is numeric/structural data — no PII, no personal scalars. The internal tier is the right floor: metrics surface via the admin trends route (`GET /api/admin/trends`) which uses `dangerously_allow_all_data_access` since the rows are aggregated server-side.

**No route changes.**

## Consequences worth tracking

None.
