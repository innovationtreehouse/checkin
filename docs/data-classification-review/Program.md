# Data Classification Review — Program

> Source: `prisma/schema.prisma` lines 235–277 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

**Status:** ✅ Reviewed — all 17 fields confirmed at current tiers. No fresh schema changes.

A multi-event program (e.g. summer camp, classes). Has a lead mentor, optional age range and capacity, pricing, and a Shopify product mapping.

## Fields

| Field | Type | Tier | OK? | Notes |
|---|---|---|---|---|
| id | Int (PK) | public | ✓ | programs are publicly advertised entities |
| name | String | public | ✓ | program name appears in public catalog |
| leadMentorId | Int? | pii | ✓ | propagated from `Participant.id` during the [Participant](Participant.md) review |
| begin | DateTime? | public | ✓ | program start date — public catalog data |
| end | DateTime? | public | ✓ | program end date — public catalog data |
| phase | ProgramPhase | public | ✓ | PLANNING / UPCOMING / ACTIVE / etc. — listing state |
| enrollmentStatus | EnrollmentStatus | public | ✓ | OPEN / CLOSED / WAITLIST — catalog state |
| memberOnly | Boolean | public | ✓ | shown to non-members so they know member benefits exist |
| minAge | Int? | public | ✓ | age range for eligibility — listing data |
| maxAge | Int? | public | ✓ | age range for eligibility — listing data |
| maxParticipants | Int? | public | ✓ | capacity — listing data |
| leadMentorNotificationSettings | Json? | personal | ✓ | mentor's own notification prefs — confirmed at personal (NOT bumped to internal like Participant.notificationSettings) |
| memberPrice | Int? | public | ✓ | shown on shop pages |
| nonMemberPrice | Int? | public | ✓ | shown on shop pages |
| shopifyProductId | String? | public | ✓ | used in `shopify.checkout-url` outbound (public tier); pinning higher would block outbound |
| shopifyMemberVariantId | String? | public | ✓ | used in outbound URL |
| shopifyNonMemberVariantId | String? | public | ✓ | used in outbound URL |

## Tier counts

public: 15 · pii: 1 · personal: 1 · internal: 0 · secret: 0

## Decision log (2026-05-14)

Programs are public catalog entities by design. All advertising-facing fields (name, dates, phase, eligibility, capacity, prices) and Shopify mapping IDs remain `public` — they appear on `/programs` pages, the shop, and in outbound Shopify checkout URLs. Tightening any of them would force the public catalog and the existing `shopify.checkout-url` outbound (currently `['public', 'pii']`) to widen, which has no privacy benefit.

`leadMentorId` is `pii` (propagated). This intentionally restricts the lead mentor's id from anyone-tier views; the consequence on `GET /api/programs/[id]` was flagged in the [Participant](Participant.md) "Consequences worth tracking" section.

`leadMentorNotificationSettings` left at `personal` — diverges from `Participant.notificationSettings` (which was bumped to `internal`). The user's deliberate call: the mentor's notification prefs for their own program are personal to them, and a more permissive tier here doesn't expose anyone else's settings.

**FK propagation:** None needed — the only FK-tier field (`leadMentorId`) was already propagated during the Participant review.

**No route changes.**

## Consequences worth tracking

None new. The lead-mentor visibility consequences were already documented in [Participant](Participant.md) (anyone-tier program pages no longer expose the mentor's id/name).
