# Data Classification Review — Household

> Source: `prisma/schema.prisma` lines 142–157 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

A family unit. Participants belong to at most one Household; Households have HouseholdLeads who manage members. Carries the address and emergency contact for the family.

## Fields

| Field | Type | Current tier | OK? | Notes |
|---|---|---|---|---|
| id | Int (PK) | public | | |
| name | String? | public | | |
| address | String? | personal | | |
| emergencyContactName | String? | personal | | |
| emergencyContactPhone | String? | personal | | |

## Tier counts

public: 2 · pii: 0 · personal: 3 · internal: 0 · secret: 0

## Review notes

_Free-form observations or proposed changes._
