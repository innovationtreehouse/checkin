# Data Classification Review — SystemMetric

> Source: `prisma/schema.prisma` lines 513–522 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

Time-series application metrics emitted by the server (counters, latencies, etc.).

## Fields

| Field | Type | Current tier | OK? | Notes |
|---|---|---|---|---|
| id | Int (PK) | internal | | |
| timestamp | DateTime | internal | | |
| metric | String | internal | | |
| value | Float | internal | | |

## Tier counts

public: 0 · pii: 0 · personal: 0 · internal: 4 · secret: 0

## Review notes

_Free-form observations or proposed changes._
