# Data Classification Review — FeePayment

> Source: `prisma/schema.prisma` lines 327–345 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

A record of a participant paying a fee — carries external payment references (Shopify, QuickBooks) and any admin note. Compound primary key `(feeId, participantId)`.

## Fields

| Field | Type | Current tier | OK? | Notes |
|---|---|---|---|---|
| feeId | Int | public | | |
| participantId | Int | public | | |
| paidOn | DateTime? | personal | | |
| shopifyLink | String? | personal | | |
| quickBooksInvoice | String? | personal | | |
| customNote | String? | personal | | |

## Tier counts

public: 2 · pii: 0 · personal: 4 · internal: 0 · secret: 0

## Review notes

_Free-form observations or proposed changes._
