# AGENTS.md

Orientation for agents working in this repo. The app is a Next.js + Prisma +
PostgreSQL membership/check-in system under `checkin-app/`.

## Editing files

Before a multi-file edit sweep, Read every target file first — batch all the
Reads in one round — then Edit. Don't interleave read/edit/read/edit; the
harness rejects any Edit/Write on a file you haven't Read this session ("File
has not been read yet"), so front-loading the Reads avoids a stall per file.
After a `git merge`/`rebase`/`cherry-pick` (or any external write) touches a
file you're about to edit, re-Read it first — it counts as modified since your
last Read.

## Test classes

There are **three** classes of tests. Run all commands from `checkin-app/`.

### 1. Unit tests — `*.test.ts(x)`
In-process, no database. `@/lib/prisma`, `next-auth`, and `fetch` are mocked in
`jest.setup.js`. Run: `npm run test:ci` (this is the CI default). These must
never hit a real DB — the prisma mock rejects real calls.

### 2. Integration tests — `*.integration.test.ts`
In-process, but talk to a **real Postgres** via `DATABASE_URL` (the prisma mock
defers to the real client for these). They import service functions directly and
assert DB state. Excluded from the default run. Run: `npm run test:integration`
against a live DB. Each suite self-cleans by a unique `TAG`.

### 3. Flow tests — `flow-tests/*.flow.test.ts`  ← read this before adding e2e
**End-to-end user journeys driven over HTTP against a *running* dev server.** No
app imports, no DB access, no mocks — a flow test only `fetch()`es the server and
asserts responses, exactly as a client would. This is how we verify a whole
journey (intake → review → payment, check-in, etc.) wired through the real
routes, auth, and DB together.

- **Config:** `jest.flow.config.js` (node env, **skips `jest.setup.js`** so it
  uses native `fetch` with `getSetCookie` and no prisma/next-auth mocks).
- **Run locally, no setup:** `npm run test:flow:standalone` (from `checkin-app/`)
  — brings up `deploy/docker-compose.flow.yml` (Postgres + seeded dev server),
  runs the suite inside that container, tears down. This is what CI does; use
  it unless you already have a dev server running.
- **Run against a server you already have up:** start the app (`npm run dev`,
  serves `:4000`) against a seeded local DB, then `npm run test:flow`. Bare
  `test:flow` does NOT start anything — it assumes `:4000` is already live and
  fails with a connection error otherwise. Override the target with
  `FLOW_BASE_URL=http://host:port`.
- **Auth:** `flow-tests/helpers.ts` → `loginAs(email)` signs in via the local
  **persona-mint** flow (resolves the seeded persona by its stable email, since
  ids are autoincrement) and returns a cookie jar; `api(session, path, init)`
  is a thin JSON `fetch` wrapper.
- **In CI:** the `Flow tests` workflow (`.github/workflows/flow-tests.yml`) brings
  up `deploy/docker-compose.flow.yml` — Postgres + a **dev-mode** app container
  (`next dev`) — installs, `prisma db push`, seeds, then runs the flow tests
  inside that container.

**Gotchas (why it's built this way):**
- Use the **dev** server, never the production image: persona-mint login is gated
  on `NODE_ENV != production`, and the prod `Dockerfile` pins `NODE_ENV=production`.
  So flow tests would have no way to authenticate against the prod image.
- The server must run with `CHECKIN_ENV=local` (enables persona-mint) and a
  **freshly seeded** DB (`prisma db seed`) — flow tests assume the seed's baseline
  personas/households (e.g. `parent.family2@example.com` is a non-member household
  lead; `boardmember@example.com` is sysadmin+board).
- Flow tests **mutate** seeded state, so they assume a fresh seed per run (CI
  reseeds every run). Don't rely on re-running against the same DB locally.
- `*.flow.test.ts` is excluded from the unit/integration runs (it needs a live
  server) — keep it that way; run it only via `npm run test:flow`.
- **No test tier exercises real Google OAuth.** Flow tests authenticate via
  persona-mint (a credentials sign-in), which — with JWT sessions — never
  touches the NextAuth **PrismaAdapter**; the adapter's user methods run only
  inside the live Google OAuth callback. The adapter↔model mapping in
  `checkin-app/src/lib/auth-options.ts` is guarded by tsc (keep the
  `user: prisma.person` reference cast-free) and by
  `src/lib/__tests__/auth-options-adapter.test.ts`. Regression to learn from:
  the Participant→Person rename (#708) left `.participant` in that mapping
  behind an `as` cast — CI stayed fully green while every Google sign-in on
  the dev instance 500'd in the OAuth callback.

To add a journey: drop a `flow-tests/<name>.flow.test.ts` using `loginAs`/`api`,
keep it to real HTTP calls + response assertions. Prefer routes that don't need
external integrations (Zoho/Shopify/Averity); use the board/admin manual-action
routes to advance flows those would otherwise gate. Real journeys are catalogued
in `docs/designs/CUJS.md` — start there when choosing what to cover.

## Docs map

Read these before changing the relevant area — start here, then follow links.

**Project-wide**
- `README.md` — what the app is + Quick Start; OS setup: `docs/setup/SETUP_LINUX.md`, `docs/setup/SETUP_MACOS.md`.
- `CONSTITUTION.md` — project principles//ground rules.
- `GEMINI.md`, `.jules/sentinel.md` — instructions for other agents (Gemini, Jules); keep cross-consistent with this file.
- `TRADEMARKS.md` — naming/brand constraints.

**Design & product** (`docs/designs/`)
- `DESIGN.md` — system design overview.
- `CUJS.md` — **critical user journeys** (the basis for flow tests).
- `DEV_INSTANCE_DESIGN.md` — the `CHECKIN_ENV` prod/dev/local model + persona-mint/impersonation (read before touching auth/env).
- `DEV_DASHBOARD_DESIGN.md` — dev dashboard + seed/reset macros.
- `PRODUCTION_PLAN.md`, `implementation_plan.md`, `MY_PROGRAMS_SCOPING.md`, `ARCHITECT_IDEAS_*.md` — roadmap/scoping notes.

**Security** (`docs/security/`)
- `SECURITY-POLICY.md` — the response-stripper / `@sensitivity` registry rules (read before adding API responses or schema fields).
- `pentest_findings_2026-04-21.md` — prior findings.

**Deploy & migrations** (`checkin-app/docs/`)
- `DEPLOY_MIGRATION_ORDER_OF_OPERATIONS.md` — infra rules + order of operations for schema migrations vs. deploys (read before writing a migration); `.claude/skills/migration-safety/` fires this as a checklist whenever a migration is being built.
- `MIGRATION_COALESCE_FLOW.md` — the pre-release migration-coalesce policy + script (`scripts/coalesce-migrations.ts`), the release gate (at most 1 new migration per release), and the dev/prod ledger-reconcile procedure.

**Subprojects** (each has its own `README.md`)
- `client/` — the Raspberry-Pi kiosk client (Python).
- `packages/*` (e.g. `monitoring-db`, `pg-test-harness`, `telemetry`), `layers/prisma-runtime/`, and the Lambda `*-function/` dirs (`s-read-function/`, `s-replay-function/`, `monitoring-relay-function/`, `monitoring-watchdog-function/`) — see the README in each; `s-read-function/` also has `MONITORING-PRD.md` + `FUTUREWORK.md`.
