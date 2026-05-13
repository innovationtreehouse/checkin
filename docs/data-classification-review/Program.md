# Data Classification Review — Program

> Source: `prisma/schema.prisma` lines 235–277 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

A multi-event program (e.g. summer camp, classes). Has a lead mentor, optional age range and capacity, pricing, and a Shopify product mapping.

## Fields

| Field | Type | Current tier | OK? | Notes |
|---|---|---|---|---|
| id | Int (PK) | public | | |
| name | String | public | | |
| leadMentorId | Int? | public | | |
| begin | DateTime? | public | | |
| end | DateTime? | public | | |
| phase | ProgramPhase | public | | |
| enrollmentStatus | EnrollmentStatus | public | | |
| memberOnly | Boolean | public | | |
| minAge | Int? | public | | |
| maxAge | Int? | public | | |
| maxParticipants | Int? | public | | |
| leadMentorNotificationSettings | Json? | personal | | |
| memberPrice | Int? | public | | |
| nonMemberPrice | Int? | public | | |
| shopifyProductId | String? | public | | |
| shopifyMemberVariantId | String? | public | | |
| shopifyNonMemberVariantId | String? | public | | |

## Tier counts

public: 16 · pii: 0 · personal: 1 · internal: 0 · secret: 0

## Review notes

_Free-form observations or proposed changes._
