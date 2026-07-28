# Shopify LIVE contract tests (dev store)

**Status: SHIPPED (layer 1).** Verified in tree: the `shopify-live/` jest project
(`jest.shopify-live.config.js`, `npm run test:shopify-live`), `shopify-live/guard.ts`
+ its NORMAL-CI unit test `src/lib/__tests__/shopifyLiveGuard.test.ts`, and
`scripts/shopify-live-janitor.ts`. The suites drive the real `lib/shopify.ts`
functions (`createShopifySingleVariantProgram`, `adjustProgramInventory`,
`mintMemberDiscountCode`, `getAccessToken`) with no fetch mocks. The workflow is
**dormant until credentials are provisioned** (below).

**Related:** `SHOPIFY_DEV_STORE_WEBHOOK.md`, `docs/PROGRAM_CAPACITY_AND_SCHOLARSHIPS.md`.

## Why this layer exists (what mocks structurally cannot catch)

Every other Shopify test runs against a mock, which verifies *our* request-building
but cannot catch: **semantics drift** we depend on (e.g. `allocation_method:'each'`
valuing a qty-N cart per-unit — the multi-child overcharge class, caught in #930
review not by tests; `inventory_policy:deny` refusing oversell), **API-version
sunsets** (`SHOPIFY_API_VERSION` is pinned; a retired version gets silently served
by a different one), and **contract shape** (fields/headers as Shopify actually
stores them, not as fixtures remember). The live suite pins those against a real
dev store.

## Dev-store-only, by construction (the safety decision)

`guard.ts` is pure and unit-tested in the normal CI suite, so the guard is verified
even though the live suite never runs in CI. Three layers, deliberately redundant:
1. **Denylist** — the production domain is refused unconditionally.
2. **Double key** — `SHOPIFY_STORE_DOMAIN` (pinned in the workflow) must equal the
   human-provisioned `SHOPIFY_LIVE_ALLOWED_DOMAIN` repo variable: retargeting the
   suite at another store takes two deliberate edits in two places.
3. **Shape** — `*.myshopify.com` only.

## Cleanup discipline (the decision)

Every created resource is tagged (`citest-<runId>` titles, reserved
`PRG9999999xx-` programId range) and registered the moment it exists, so a failed
assertion still cleans up in `afterAll`. `shopify-live-janitor.ts` sweeps tagged
resources before each run (24h cutoff — clears crashed leftovers) and after with
`always()` + 0h cutoff (a red run must not leak catalog objects).

## Provisioning (one-time, repo Settings — not yet done)

- Variables: `SHOPIFY_LIVE_ENABLED=true`,
  `SHOPIFY_LIVE_ALLOWED_DOMAIN=treehouse-dev-4folhtgx.myshopify.com`.
- Secrets: `SHOPIFY_LIVE_CLIENT_ID` / `SHOPIFY_LIVE_CLIENT_SECRET` (scopes:
  `write_products`, `write_inventory`, `write_price_rules`, `read_locations`).
- Until then the workflow's `if:` gate keeps it dormant; the first
  `workflow_dispatch` is the acceptance test. Nightly red is **non-blocking**
  (notification-only) until the suite has a week of green; then consider making it
  a required check on `promote-prod`.

## Deliberately deferred

- **E2E webhook smoke** (Admin-API paid order → real `orders/paid` → ops-dev
  activation) — layer 2; needs the dev store's webhook pointed at ops-dev (#740's
  registration script).
- **Config-drift reconciliation** (BoardSettings/program variant ids vs the store)
  — layer 3.
- **Product archive-status contract** — belongs with #955 when it merges
  (`setProgramListingArchived` isn't on main yet).
- **Hosted-checkout UI automation** — Shopify's UI, brittle, low value; the
  API-created-paid-order path covers everything downstream of payment.
