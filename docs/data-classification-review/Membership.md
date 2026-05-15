# Data Classification Review — Membership

> Source: `prisma/schema.prisma` lines 171–196 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

**Status:** ✅ Reviewed — every descriptive field tightened to `internal`. See decision log and consequences below.

A paid/granted membership in the org. Type is HOUSEHOLD, VOLUNTEER, or CORPORATE; only one of `householdId` / `volunteerId` / `corporateId` is set per row. Carries the Shopify receipt and Docusign waiver references.

## Fields

| Field | Type | Tier | OK? | Notes |
|---|---|---|---|---|
| id | Int (PK) | internal | ↑ | was public — entire membership row is now admin/staff-only |
| since | DateTime | internal | ↑ | was public — start-date of a person's/household's relationship with org |
| type | MembershipType | internal | ↑ | was public — HOUSEHOLD/VOLUNTEER/CORPORATE |
| active | Boolean | internal | ↑ | was public — whether the membership is currently in effect |
| latestShopifyReceipt | String? | internal | ↑ | was personal — receipt pointer; admin-only artifact |
| latestDocusign | String? | internal | ↑ | was personal — Docusign envelope pointer; admin-only artifact |
| householdId | Int? | personal | ✓ | propagated from `Household.id` during the [Household](Household.md) review |
| volunteerId | Int? | pii | ✓ | propagated from `Participant.id` during the [Participant](Participant.md) review |
| corporateId | Int? | public | — | left pending — will be reviewed when [Corporation](Corporation.md) is reviewed |

## Tier counts

public: 1 · pii: 1 · personal: 1 · internal: 6 · secret: 0

## Decision log (2026-05-14)

Six descriptive fields tightened from public/personal → internal. The user's policy intent: Membership is admin/staff data, not member-visible data. Members may know they have a membership (gated through their relationship with their own household / volunteer participant row), but the Membership row's contents are not theirs to read.

**FK propagation:** None needed. The two propagated FKs (householdId, volunteerId) keep their inherited tiers because they reflect the sensitivity of the referenced ID, not the sensitivity of the row's existence. Functionally moot: any caller with internal-tier access already covers all lower tiers, so the FK tier choice only matters for callers who lack internal access — and those callers will see nothing from this row anyway. `corporateId` remains at `public` pending [Corporation](Corporation.md).

**No route changes:** every Membership-returning route already gates correctly:
- `POST /api/admin/households` (envelope: `membership`) — sysadmin/board view, full internal coverage ✓
- `/api/admin/households` (sysadmin/board) — full internal coverage ✓
- `/api/admin/participants/search` (sysadmin/board) — full internal coverage ✓

The routes that *use* memberships in their handler logic (e.g. `/api/programs/[id]` and `/api/programs` for the member-only gate) only read `participant.memberships.length` for the access decision and never surface the rows to the response.

## Consequences worth tracking

These are real behavioral changes from the tier tightening:

- **`GET /api/household` (authenticated callers)** — the response includes `memberships: { where: { active: true } }` for the caller's own household. With every Membership field now `internal`, household members and leads will get an array of empty objects (`memberships: [{}]`) instead of populated rows. The array length is still useful for boolean "you have an active membership" checks on the client; field-level data (type, since, receipts) is dropped. If the household page UX needs to display membership state explicitly, the handler should derive a boolean (e.g. `hasActiveMembership: true`) rather than shipping the rows. Adding `their_households:internal` to the authenticated view would also unmask internal Participant fields (`sysadmin`, `keyholder`, `lastBackgroundCheck`, etc.) for everyone in the household — bad trade.

- **Member-only program access checks** — unchanged. The check (`participant.memberships.length > 0`) happens server-side before the membership rows could reach the stripper, so the tier change doesn't affect program-access enforcement.

## Pending consistency item

`Membership.corporateId` is still `public`. Resolve when reviewing [Corporation](Corporation.md).
