# Data Classification Review — Corporation

> Source: `prisma/schema.prisma` lines 198–209 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

**Status:** ✅ Reviewed — descriptive fields tightened to `internal`. PK confirmed as `public`. See decision log.

An organization that holds a corporate membership. Has leads (who manage it) and members (who get access via the corp membership).

## Fields

| Field | Type | Tier | OK? | Notes |
|---|---|---|---|---|
| id | Int (PK) | public | ✓ | confirmed — orgs (not natural persons) are weakly identified. `Membership.corporateId` stays public to match |
| primaryEmail | String? | internal | ↑ | was pii — may be a real person's work email; admin-only is safer |
| address | String? | internal | ↑ | was personal — schema can't distinguish public business addr from sensitive home addr; admin-only |

## Tier counts

public: 1 · pii: 0 · personal: 0 · internal: 2 · secret: 0

## Decision log (2026-05-14)

Two fields tightened to internal. PK kept at public.

**FK propagation:** None needed.
- `CorporationLead.corporationId` and `CorporationMember.corporationId` remain at `public` to match the PK.
- `Membership.corporateId` was flagged as a pending consistency item during the Membership review — confirmed: it stays `public` to match the PK, resolving the pending item.

**No route changes:** the Corporation model is defined but currently unused in `registry.ts` and route handlers (`grep -rn corporation src/app/api` returns nothing). The tier tightening is defensive — when corporate features ship, they start from a tight default.

## Consequences worth tracking

None now (no routes return Corporation rows). When corporate features are wired up, callers will need `everyones:internal` or staff-level scoping to read `primaryEmail` / `address`. The PK can travel publicly.

## Pending consistency items

None — this review closes the Membership.corporateId item.
