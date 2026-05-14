# Data Classification Review — FeePayment

> Source: `prisma/schema.prisma` lines 327–345 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

**Status:** ✅ Reviewed — every descriptive field tightened to `internal`.

A record of a participant paying a fee — carries external payment references (Shopify, QuickBooks) and any admin note. Compound primary key `(feeId, participantId)`.

## Fields

| Field | Type | Tier | OK? | Notes |
|---|---|---|---|---|
| feeId | Int | public | ✓ | propagated from `Fee.id` (public, confirmed) |
| participantId | Int | pii | ✓ | propagated from `Participant.id` during the [Participant](Participant.md) review |
| paidOn | DateTime? | internal | ↑ | was personal — payment timestamp, admin/accounting artifact |
| shopifyLink | String? | internal | ↑ | was personal — external Shopify receipt pointer |
| quickBooksInvoice | String? | internal | ↑ | was personal — accounting reference |
| customNote | String? | internal | ↑ | was personal — admin's free-text annotation |

## Tier counts

public: 1 · pii: 1 · personal: 0 · internal: 4 · secret: 0

## Decision log (2026-05-14)

Four descriptive fields tightened from personal → internal. Same direction as [Membership](Membership.md): payment-related external pointers and timestamps are admin/accounting artifacts, not member-visible data. Treats FeePayment consistently with `Membership.latestShopifyReceipt` and `Membership.latestDocusign`.

**FK propagation:** None — feeId and participantId already propagated.

**No route changes:** The only handler that touches FeePayment is `/api/admin/participants/merge` (sysadmin/board only, full internal coverage). FeePayment isn't surfaced on any non-admin route today.

## Consequences worth tracking

- **Participant self-service receipt visibility** — the participant loses self-visibility on `paidOn` / `shopifyLink` / `quickBooksInvoice`. Today no route surfaces these to the participant, so no current UX regression. If a future "Receipts" page is built for participants, the route view will need to grant `their_own:internal` (or a route-level dangerously_allow_all_data_access ack pattern, similar to POST /api/household).

## Pending consistency items

None.
