# Data Classification Review — Event

> Source: `prisma/schema.prisma` lines 347–374 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

A single scheduled event — optionally part of a Program, optionally part of a recurring group. Carries attendance-confirmation metadata (who confirmed, when, whether the wrap-up email went out).

## Fields

| Field | Type | Current tier | OK? | Notes |
|---|---|---|---|---|
| id | Int (PK) | public | | |
| programId | Int? | public | | |
| name | String | public | | |
| start | DateTime | public | | |
| end | DateTime | public | | |
| description | String? | public | | |
| attendanceConfirmedAt | DateTime? | internal | | |
| attendanceConfirmedById | Int? | internal | | |
| postEventEmailSent | Boolean | internal | | |
| recurringGroupId | String? | public | | |

## Tier counts

public: 7 · pii: 0 · personal: 0 · internal: 3 · secret: 0

## Review notes

_Free-form observations or proposed changes._
