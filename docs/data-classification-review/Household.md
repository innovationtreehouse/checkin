# Data Classification Review — Household

> Source: `prisma/schema.prisma` lines 142–157 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

**Status:** ✅ Reviewed — all 5 fields tightened. See decision log below.

A family unit. Participants belong to at most one Household; Households have HouseholdLeads who manage members. Carries the address and emergency contact for the family.

## Fields

| Field | Type | Tier | OK? | Notes |
|---|---|---|---|---|
| id | Int (PK) | personal | ↑ | was public — closes consistency gap with FKs (`Participant.householdId`, `HouseholdLead.householdId`, `Membership.householdId` were all bumped to `personal` during the [Participant](Participant.md) review) |
| name | String? | pii | ↑ | was public — household names like "The Smith Family" identify the family |
| address | String? | pii | ↑ | was personal — same data as `Participant.homeAddress`, which we also bumped to pii |
| emergencyContactName | String? | pii | ↑ | was personal — third-party name + phone; matches Participant.phone (pii) tier |
| emergencyContactPhone | String? | pii | ↑ | was personal — phone number of a real person |

## Tier counts

public: 0 · pii: 4 · personal: 1 · internal: 0 · secret: 0

## Decision log (2026-05-14)

All five fields tightened. The Participant review left `Household.id` as a pending consistency item; this review closes it.

**FK propagation:** None needed. The three FK references to `Household.id` (`Participant.householdId`, `HouseholdLead.householdId`, `Membership.householdId`) were already bumped to `personal` during the Participant review, so the PK → personal change just closes the consistency gap.

**Route change:** `POST /api/household` switched from a tier-gated `orderedView` to `dangerously_allow_all_data_access: true` (write-only ack). The route returns the caller's just-created household to the caller themselves, but the session hasn't been refreshed yet within the request — `ctx.householdId` is still null when the stripper runs, so `their_households` scope can't recognize the new row as the caller's own. Without the bypass, every field of the just-created household would be stripped from the response to the very user who created it. The handler gates creation on the caller having no existing household and connects them as participant + lead, so the returned row is by construction owned by the caller.

Handler return shape adjusted from `{ Household: household }` to `{ household }` to match the lowercase envelope convention used by `dangerously_allow_all_data_access` routes (which ship the bag verbatim, with no automatic envelope-key remapping).

## Consequences worth tracking

These are intentional behavioral changes from the tier tightening:

- **`GET /api/admin/emergency-contacts` (keyholder)** — keyholders still see all fields. Their view grants `everyones:pii` + `everyones:personal`, which fully covers Household's new tier set. No change in caller experience.
- **`GET /api/household` (authenticated)** — household members still see their own household. The authenticated view grants `their_households:pii` + `their_households:personal`, fully covering the new tiers. No change.
- **`POST /api/household` (authenticated)** — the write-only-ack pattern is now applied (see above). Caller still sees the full just-created household entity in the response.

Routes that previously surfaced `Household.id` or `Household.name` to callers who weren't members of that household are no longer in scope: there were no such routes in `registry.ts` — every household-envelope route already restricted access via `their_households` scope or admin roles.

## Pending consistency items

None — Household is fully aligned with Participant after this review.
