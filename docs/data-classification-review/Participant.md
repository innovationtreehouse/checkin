# Data Classification Review — Participant

> Source: `prisma/schema.prisma` lines 59–116 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

**Status:** ✅ Reviewed — 6 tightenings applied to schema + propagated to FK references. See decision log below.

Every person known to the system — members, volunteers, household members, board members, staff. Also carries org roles (sysadmin, boardMember, keyholder, shopSteward).

## Fields

| Field | Type | Tier | OK? | Notes |
|---|---|---|---|---|
| id | Int (PK) | pii | ↑ | was public — also bumped every public FK reference to pii (`*.participantId`, `*.userId`, `*.volunteerId`, `*.leadMentorId`) |
| googleId | String? @unique | pii | ✓ | |
| email | String? @unique | pii | ✓ | |
| phone | String? | pii | ✓ | |
| name | String? | pii | ↑ | was public |
| emailVerified | DateTime? | internal | ✓ | |
| image | String? | personal | ↑ | was public |
| dob | DateTime? | pii | ✓ | |
| homeAddress | String? | pii | ↑ | was personal |
| lastWaiverSign | DateTime? | internal | ✓ | |
| waiverSignedBy | Int? | internal | ✓ | |
| lastBackgroundCheck | DateTime? | internal | ✓ | |
| notificationSettings | Json? | internal | ↑ | was personal |
| householdId | Int? | personal | ↑ | was public — also bumped `HouseholdLead.householdId` and `Membership.householdId` to personal |
| sysadmin | Boolean | internal | ✓ | |
| boardMember | Boolean | public | ✓ | published role |
| keyholder | Boolean | internal | ✓ | |
| shopSteward | Boolean | internal | ✓ | |

## Tier counts

public: 1 · pii: 6 · personal: 2 · internal: 9 · secret: 0

## Decision log (2026-05-13)

Six fields tightened. All other annotations confirmed as-is.

**FK propagation (Participant.id → pii):** `ToolStatus.userId`, `HouseholdLead.participantId`, `Membership.volunteerId`, `CorporationLead.participantId`, `CorporationMember.participantId`, `Program.leadMentorId`, `ProgramVolunteer.participantId`, `ProgramParticipant.participantId`, `FeePayment.participantId`, `RSVP.participantId`, `Visit.participantId` — all bumped from public to pii. FK columns already at internal or stricter (`Account.userId`, `Session.userId`, `RawBadgeEvent.participantId`, `Event.attendanceConfirmedById`, audit FKs, `Participant.waiverSignedBy`) left alone.

**FK propagation (Participant.householdId → personal):** `HouseholdLead.householdId`, `Membership.householdId` — both bumped from public to personal. `Household.id` itself (the PK) left as `public` pending the [Household](Household.md) review.

**Outbound:** `shopify.checkout-url` widened from `['public']` to `['public', 'pii']` — it embeds `participant.id` in the checkout URL.

## Consequences worth tracking

These are intentional behavioral changes from the tier tightening. Each is a route whose now-restricted callers will see less data:

- **`GET /api/programs/[id]` and `GET /api/programs` (anyone-tier callers)** — public program pages no longer expose the lead mentor's id/name/image. Programs themselves still show.
- **`GET /api/directory/board` (keyholder-tier callers)** — keyholder view was already narrowed to `['public']` pre-tightening; with id/name now pii, that view becomes effectively empty for keyholders. Sysadmin/board still see full payload.
- **`GET /api/shop/members` (authenticated non-staff callers)** — authenticated callers only get `['public']` here, which now means no participant data. Shop staff (sysadmin/board/shopSteward) keep the full directory.

If any of those need to keep working for the restricted callers, widen the relevant view in `registry.ts` (e.g. add `everyones:pii`) — that's a deliberate per-route policy call, not a mechanical follow-up.

## Pending consistency item

`Household.id` (PK) is still `public` while `Participant.householdId`, `HouseholdLead.householdId`, and `Membership.householdId` are all `personal`. The same value leaks at a lower tier via routes that return Household rows directly. Resolve when reviewing [Household.md](Household.md).
