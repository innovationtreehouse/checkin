# Shopify LIVE contract tests (dev store)

**Status:** Implemented (layer 1 of the Shopify test plan). Nightly workflow is
dormant until credentials are provisioned (§5).
**Related:** `docs/designs/SHOPIFY_DEV_STORE_WEBHOOK.md`,
`docs/PROGRAM_CAPACITY_AND_SCHOLARSHIPS.md`, `lib/shopify.ts`.

## 1. Problem

Every automated Shopify test today — unit (`lib/__tests__/shopify.test.ts`),
integration (`CHECKIN_ENV=local` mock), flow — runs against a mocked Shopify.
Mocks verify *our* request-building; they structurally cannot catch:

- **Semantics drift** we depend on: `allocation_method: 'each'` valuing a
  qty-N cart per-unit (the multi-child overcharge class, caught in review of
  #930, not by tests), relative `inventory_levels/adjust` behavior,
  `inventory_policy: deny` refusing oversell, product `status` transitions.
- **API-version sunsets**: `SHOPIFY_API_VERSION` is pinned; when Shopify
  retires it, calls get silently served by a different version.
- **Contract shape**: fields and headers as Shopify actually stores/returns
  them, not as our fixtures remember them.

## 2. Shape

`checkin-app/shopify-live/` — a separate jest project
(`jest.shopify-live.config.js`, `npm run test:shopify-live`) excluded from
unit/CI/pre-commit runs, mirroring the flow-tests convention. The suites drive
the app's REAL `lib/shopify.ts` functions (`createShopifySingleVariantProgram`,
`adjustProgramInventory`, `mintMemberDiscountCode`, `getAccessToken`) with no
fetch mocks; only `@/lib/prisma` and `@/lib/email` are mocked, so the lib's
failure-report path can't write to a DB or email the board from a test run.

Suites (serialized, `maxWorkers: 1`, ~25 Admin calls per run against the
2 req/s REST budget):

| Suite | Contract pinned |
|---|---|
| `product-inventory` | create → active product, managed `deny` variant at the right price; initial inventory = maxParticipants; relative ±1 adjusts (the #930 hold-ledger ops) |
| `discount` | minted price rule is `fixed_amount` + **`each`** + entitled-variant-scoped + single-use + ~48h window |
| `api-version-canary` | `shop.json` answers 200 **on the pinned version** (`x-shopify-api-version` echo) with no `x-shopify-api-deprecated-reason` |

## 3. Dev-store-only, by construction

`shopify-live/guard.ts` (pure; unit-tested in the NORMAL CI suite via
`src/lib/__tests__/shopifyLiveGuard.test.ts`, so the guard is verified even
though the live suite never runs in CI):

1. **Denylist** — the production domain (public, from infra
   `modules/checkin/overview.tf`) is refused unconditionally.
2. **Double key** — `SHOPIFY_STORE_DOMAIN` (pinned in the workflow) must equal
   the `SHOPIFY_LIVE_ALLOWED_DOMAIN` repo variable (provisioned by a human):
   retargeting requires two deliberate edits in two places.
3. **Shape** — `*.myshopify.com` only.

## 4. Cleanup discipline

- Every created resource is tagged: product titles carry `citest-<runId>`,
  price rules use the reserved `PRG9999999xx-` programId range.
- Suites register ids the moment they exist (`trackProduct`/`trackPriceRule`)
  and delete them in `afterAll`, so a failed assertion still cleans up.
- `scripts/shopify-live-janitor.ts` sweeps tagged resources: before each run
  (24h cutoff — clears crashed-run leftovers) and after each run with
  `always()` + 0h cutoff (a red run must not leak catalog objects). Safe to run
  by hand.

## 5. Provisioning (one-time, repo Settings)

- Variables: `SHOPIFY_LIVE_ENABLED=true`,
  `SHOPIFY_LIVE_ALLOWED_DOMAIN=treehouse-dev-4folhtgx.myshopify.com`.
- Secrets: `SHOPIFY_LIVE_CLIENT_ID` / `SHOPIFY_LIVE_CLIENT_SECRET` — the dev
  store app's credentials (scopes: `write_products`, `write_inventory`,
  `write_price_rules`, `read_locations`).
- Until then the workflow's `if:` gate keeps it dormant; the first
  `workflow_dispatch` run is the acceptance test.

Nightly red is **non-blocking** (notification-only) until the suite has a
week of green; then consider making it a required check on `promote-prod`.

## 6. Deliberately deferred

- **E2E webhook smoke** (Admin-API-created paid order → real `orders/paid` →
  ops-dev activation) — layer 2 of the plan; needs the dev store's webhook
  pointed at ops-dev (#740's registration script).
- **Config-drift reconciliation** (BoardSettings/program variant ids vs the
  store) — layer 3.
- Product **archive-status** contract — belongs with #955 when it merges
  (`setProgramListingArchived` doesn't exist on main yet).
- Hosted-checkout UI automation — Shopify's UI, brittle, low value; the
  API-created-paid-order path covers everything downstream of payment.
