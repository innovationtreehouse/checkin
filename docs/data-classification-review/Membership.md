# Data Classification Review — Membership

> Source: `prisma/schema.prisma` lines 171–196 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

A paid/granted membership in the org. Type is HOUSEHOLD, VOLUNTEER, or CORPORATE; only one of `householdId` / `volunteerId` / `corporateId` is set per row. Carries the Shopify receipt and Docusign waiver references.

## Fields

| Field | Type | Current tier | OK? | Notes |
|---|---|---|---|---|
| id | Int (PK) | public | | |
| since | DateTime | public | | |
| type | MembershipType | public | | |
| active | Boolean | public | | |
| latestShopifyReceipt | String? | personal | | |
| latestDocusign | String? | personal | | |
| householdId | Int? | public | | |
| volunteerId | Int? | public | | |
| corporateId | Int? | public | | |

## Tier counts

public: 7 · pii: 0 · personal: 2 · internal: 0 · secret: 0

## Review notes

_Free-form observations or proposed changes._
