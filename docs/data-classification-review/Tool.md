# Data Classification Review — Tool

> Source: `prisma/schema.prisma` lines 118–126 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

**Status:** ✅ Reviewed — all fields tightened to `internal`. See consequences below.

A piece of shop equipment that requires certification to use. Name + safety guide URL.

## Fields

| Field | Type | Tier | OK? | Notes |
|---|---|---|---|---|
| id | Int (PK) | internal | ↑ | was public — tool catalog is staff-only data |
| name | String | internal | ↑ | was public |
| safetyGuide | String? | internal | ↑ | was public |

## Tier counts

public: 0 · pii: 0 · personal: 0 · internal: 3 · secret: 0

## Decision log (2026-05-14)

All three Tool fields tightened from public → internal. Policy intent: tool inventory is shop-staff/admin data, not publicly browsable. Regular authenticated users no longer see the tool catalog via the security boundary.

**FK propagation:** `ToolStatus.toolId` lifted from public to internal alongside (see [ToolStatus.md](ToolStatus.md)).

**Test fixture update:** `stripBag` test fixture switched from `Tool` to `Fee` (now the canonical "all-public" model in stripper unit tests).

**No route changes this review.** The `GET /api/shop/tools` route still authorizes `'authenticated'` but the authenticated view only grants `['public']`. Consequence is flagged below — the simplest fix is to tighten the route's `authorize` to staff-only since the page is already a management UI in practice.

## Consequences worth tracking

- **`GET /api/shop/tools` (authenticated, non-staff)** — regular members logging in will see an empty `Tool: []` array. Sysadmin / boardMember / shopSteward continue to see the full catalog. The page at `/shop/tools` is already a Tool Management UI for staff; recommendation is to tighten `authorize` to `{ anyRole: ['sysadmin', 'boardMember', 'shopSteward'] }` to make the staff-only intent explicit at the auth layer rather than relying on the empty-response degradation.

- **`GET /api/kiosk/certifications`** — UNAFFECTED. Uses `dangerously_allow_all_data_access: true` so the kiosk still receives the tools array verbatim.

## Pending consistency items

- Recommended route hardening (above) — flagged but not auto-applied. The shop/tools page client may need to redirect non-staff users to a different page rather than render empty state.
