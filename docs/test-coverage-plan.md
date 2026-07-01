# Test Coverage Plan — `checkin-app` to 80% line coverage

Measured with `npm run test:coverage` (Jest v8 provider, full unit + integration suite; see PR #627). Re-run it to refresh these numbers:

```bash
cd checkin-app
DATABASE_URL='postgresql://…@localhost:5433/checkmein?schema=public' npm run test:coverage
# reads coverage/coverage-summary.json + coverage/lcov.info
```

## Baseline (measured, not estimated)

- **Overall line coverage: 47.6%** — 16,476 / 34,607 lines (functions 64.1%, branches 75.2%).
- Target 80% = 27,686 covered lines → **gap: 11,210 lines**.
- (The ~20% "unit-only" figure from the coverage PR is misleading — it excludes the integration tier, which is what exercises the API routes.)

## Where the gap actually is

| Bucket | Uncovered | Total | Pct |
|---|---:|---:|---:|
| `src/app/**/page.tsx` (68 files) | 10,766 | 10,843 | **0.7%** |
| `src/components/**` | 3,124 | 3,872 | 19.3% |
| `src/app/**/layout.tsx` | 760 | 841 | 9.6% |
| `src/hooks/**` | 221 | 285 | 22.5% |
| `src/lib/dev/**` | 277 | 1,060 | 73.9% |
| `src/app/api/**` route handlers | 1,703 | 8,529 | **80.0% ✅** |
| `src/lib/**` (core) | 466 | 4,416 | **89.4% ✅** |
| `src/lib/membership/**` | 159 | 2,244 | **92.9% ✅** |
| `src/security/**` | 35 | 1,502 | **97.7% ✅** |
| `src/lib/household/**` | 3 | 138 | **97.8% ✅** |
| `middleware.ts` | 0 | 58 | **100% ✅** |

**The backend is already at target.** ~76% of all uncovered lines (13,890) are in `page.tsx` + `components/**`. Closing *every* non-UI gap in the repo yields only ~4,241 lines → 59.9%, not 80%. **80% is unreachable without real React Testing Library (RTL) work on pages and components** — there is no backend shortcut. No `page.tsx` is currently rendered by any test (0/68).

## Recommended `collectCoverageFrom` exclusions (fairness cleanup)

Dev-only tooling, gated off in production, never exercised — exclude alongside the existing `generated/**` and `types/**` excludes (small: ~526 effective lines, not a real lever):

- `!src/components/Dev*.tsx` (`DevDashboard` 378, `DevLoginPicker` 113, `DevImpersonationBar` 88)
- `!src/lib/dev/actions.ts` (78)

Keep `src/lib/dev/zoho-import.ts` (68.6%) and `seed-helpers.ts` (99.7%) in scope — dev-only but already well tested. `membership-ops/broken/page.tsx` is a real admin feature despite the name — keep it in.

## Phased roadmap

| Phase | Scope | Files | Lines gained | Running total | Running % |
|---|---|---:|---:|---:|---:|
| Baseline | — | — | — | 16,476 | 47.6% |
| **1** | Mop-up: api-route stragglers, `lib/**`, `hooks/**`, all `layout.tsx`, small presentational components | 160 | +3,730 | 20,206 | 58.4% |
| **2** | Reusable shell & admin panels (RTL + fetch/session mocking) | 11 | +1,790 | 21,996 | 63.6% |
| **3** | Page Tier 1 — 15 largest / highest-traffic pages | 15 | +3,750 | 25,746 | 74.4% |
| **4** | Page Tier 2 — remaining 53 pages (many are thin list/detail/redirect stubs) | 53 | +1,984 | 27,730 | **80.1%** |

Close-rate assumptions: ~90% (Phase 1 mechanical), ~70% (Phase 2), ~65% (Phase 3 large forms), ~40% (Phase 4 long tail). Don't chase 100% per file — rare validation branches and modal error paths are a reasonable line-coverage ceiling on 500+ line pages.

### Phase 1 — foundation mop-up (mostly S effort, mechanical)
Biggest items: `api/nav/todo-counts/route.ts` (270 uncov), `api/facility/trends/route.ts` (166), the **11 `layout.tsx` files** (~760 combined — near copy-paste of the existing test), `hooks/useAutoCycle.ts` (101) / `useTodoCounts.ts` (74) / `useConflicts.ts` (46), `lib/auth-options.ts` (78, extend existing test), the `*Nav.ts` config files, and ~40 API-route stragglers (extend the existing `*.integration.test.ts` for each resource).

### Phase 2 — reusable shell & admin panels (M/L, real RTL)
`AppFrame.tsx` (361, rendered on every page — highest single leverage), `ToolManagementPanel.tsx` (559), `OnboardingGate.tsx` (220), `TrustedAdultPanel.tsx` (252), `admin/SystemHealthPanels.tsx` (229), `admin/AuditLogPanel.tsx` (223), extend `AdminEditHouseholdModal` (test exists), `BadgeDocument`/`StickerDocument` (print renderers — cheap shallow renders).

### Phase 3 — page tier 1 (L, biggest wins)
The 15 largest pages (~5,882 lines, ~77 covered): `program-ops/programs/[id]` (646), `membership` (703), `my-household` (570), `attendance/current` (528), `program-ops/sessions/[id]` (511), and 10 more (`membership-ops/*`, `programs/[id]`, `settings/membership`, `app/page`, …). RTL with `jest.mock('next-auth/react')` + `jest.mock('next/navigation')` + `global.fetch = jest.fn()`.

### Phase 4 — page tier 2 (S/M, long tail)
Remaining 53 pages. 15+ are 5–7 line `redirect()` stubs needing a one-line "renders and redirects" test; the mid-size ones follow the Phase 3 pattern.

## Conventions to mirror (already in the repo)

- **API routes** → `*.integration.test.ts` against a cloned Postgres (`test/integrationGlobalSetup.js`); e.g. `src/app/__tests__/eventMineAPI.integration.test.ts`.
- **Lib units** → `jest.mock('@/lib/prisma')`; e.g. `src/lib/__tests__/canActFor.test.ts`, `lib/membership/__tests__/intake.test.ts`.
- **Hooks** → `renderHook`; `src/hooks/__tests__/useRequireRole.test.tsx` (100%).
- **Layouts / tab gates** → `src/app/program-ops/__tests__/layout.test.tsx` (mocks `useSession`/`useRouter`/`usePathname`) — the template for the other 11.
- **Components (Mantine)** → `src/components/admin/__tests__/DataTable.test.tsx` — wrap in `<MantineProvider>`, polyfill `window.matchMedia` + `ResizeObserver` in `beforeAll`.
- **New need**: no test yet mocks `global.fetch` for a self-fetching `page.tsx`. Build **one** shared helper under `src/test-helpers/` (already excluded from coverage) that combines the session/router mocks + Mantine/jsdom polyfills + a `fetch` stub, before starting Phase 2 — so 60+ page tests don't each reinvent it.

## Bottom line

1. Stop adding backend tests for coverage's sake — api/lib/security/membership are already ≥80%; Phase 1 only mops up stragglers.
2. The whole game is `page.tsx` + `components/**` (76.6% of all uncovered lines).
3. Biggest single wins: `AppFrame.tsx`, the 11 `layout.tsx` files, and the top 5 pages.
4. Build the shared RTL fetch/session helper once (Phase 2 prerequisite).

_Baseline captured 2026-07-01 against `main`. Six integration suites were flaky during the run (assertion mismatches, not schema/mock rot) — unrelated to coverage; worth a separate stabilization pass._
