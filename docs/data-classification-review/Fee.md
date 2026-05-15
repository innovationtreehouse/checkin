# Data Classification Review — Fee

> Source: `prisma/schema.prisma` lines 311–325 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

**Status:** ✅ Reviewed — all fields confirmed as `public`. No schema changes.

A line-item fee tied to a Program (e.g. materials fee, deposit). Prices in cents for member vs non-member.

## Fields

| Field | Type | Tier | OK? | Notes |
|---|---|---|---|---|
| id | Int (PK) | public | ✓ | catalog index |
| programId | Int | public | ✓ | propagated from `Program.id` (public, confirmed) |
| name | String | public | ✓ | line-item label, appears in catalog |
| nonMemberPrice | Int | public | ✓ | price in cents, public listing |
| memberPrice | Int | public | ✓ | price in cents, public listing |

## Tier counts

public: 5 · pii: 0 · personal: 0 · internal: 0 · secret: 0

## Decision log (2026-05-14)

Fee is a product-catalog entity — same logic as Program pricing (which also stayed public). Fee describes the product, not the buyer. No tightening makes sense.

No FK propagation, no route changes, no test updates.

## Consequences worth tracking

None.
