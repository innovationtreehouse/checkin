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

## Comments

A code comment describes what the code below it does and why it exists **now**,
in the present tense. Keep it short — usually one line. Prefer making the code
self-explanatory (better names, smaller functions) over explaining it.

- **No history in comments.** Don't narrate how the code got here: no "used
  to…", "previously…", "changed because…", "workaround for the old…", bug/PR
  numbers, TODO-from-2023, or a log of past attempts. That context belongs in
  the PR description and commit message, where it's linked to the diff and
  reviewable — not stranded in the source where it rots.
- **A "why" comment is fine when the reason is non-obvious and still true** —
  an ordering constraint, an external-API quirk, a security invariant. State
  the constraint, not the story of discovering it.
- **Delete stale comments when you touch the code.** A comment that no longer
  matches the code is worse than none.
- If a comment needs multiple paragraphs to make sense, that's usually a signal
  the code or its name should change instead.

Design rationale, regressions-to-learn-from, and past approaches live in
`docs/` and PR history — not in code comments. (This file's own flow-test
section is an example: the failure stories sit in docs, not in the source.)

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
- `*.shopify-live.ts` (`checkin-app/shopify-live/`) hits the REAL Shopify
  dev store — excluded from every local/CI run; executed only by
  `.github/workflows/shopify-live.yml` (`npm run test:shopify-live`). Dev-store-only
  by a triple guard; see `checkin-app/docs/designs/SHOPIFY_LIVE_TESTS.md`.
  Deliberately NOT named `*.test.ts`: that keeps them structurally invisible to
  every other jest invocation, including scripts that override ignore patterns
  on the CLI (the test:coverage class).
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

## Issue workflow (org project 1)

Org **project 1** is the canonical triage surface; its Status field plus the
issue's assignee are the claim-state machine. An assignment means exactly one
thing: someone is actively working the issue *right now* — never leave one
standing as a soft reservation, and never trust it as the only signal.

- **Pick up**: choose an open issue that is unassigned **and** has no open PR
  claiming it. That check is two-pronged, because design PRs don't create a
  closing link: (1) `closingIssuesReferences` on open PRs / the issue's
  Development panel (implementation PRs), and (2) open PRs whose title/body
  mention `#NNN` and carry a design doc for it. Assignment is dropped when a
  PR opens, so "unassigned" alone does not mean free. Then assign yourself and
  set Status → **In progress**.
- **Re-verify before building**: issue bodies go stale — renames, moved files,
  callers added since filing. Re-run the blast-radius search against current
  `main` before implementing, and comment corrections on the issue (see #300:
  filed against `isMinor`/3 callers, fixed as `isYouth`/10 callers).
- **PR open**: set Status → **In review** and **unassign the issue**. The next
  action belongs to reviewers, not the author; a standing assignment would
  claim work that isn't happening. The open PR is what marks the issue as
  taken. How the PR references the issue depends on what it is:
  - **Implementation PR**: a closing keyword — `Fixes #NNN`, `Closes #NNN`,
    or `Resolves #NNN` (all three work) — and confirm the link registered via
    `closingIssuesReferences`.
  - **Design-doc PR**: reference the issue WITHOUT a closing keyword (plain
    `#NNN`, "Design for #NNN"). A closing link here would auto-close the
    issue when the doc merges, with nothing implemented.
- **Merge**: an implementation PR needs nothing manual — the closing keyword
  closes the issue and the project's built-in workflows (Item closed / Pull
  request merged) set Status → Done. A merged design-doc PR leaves the issue
  open: set Status back to **Ready** for implementation pickup.

Project-field writes need the `project` token scope; if GraphQL returns
INSUFFICIENT_SCOPES, have the user run `gh auth refresh -s project`.

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
- `PRODUCTION_PLAN.md`, `MY_PROGRAMS_SCOPING.md`, `ARCHITECT_IDEAS_*.md` — roadmap/scoping notes.

**Security** (`docs/security/`)
- `SECURITY-POLICY.md` — the response-stripper / `@sensitivity` registry rules (read before adding API responses or schema fields).
- `pentest_findings_2026-04-21.md` — prior findings.
- **Boundary isolation rule**: the handler/registry layer (`checkin-app/src/security/`) exists to make the data policy easy to AUDIT — it is not a substitute for careful route management (tight selects, deliberate response shapes). Any change to the boundary itself — registry grants, token grammar, handler/stripper, scope bindings, or a re-tier of an existing field's `@sensitivity` — must ship **in its own PR** (tests/docs/schema annotations may accompany; no app/feature code). New registered route: land the registry entry PR first (an unused `defineRoute` is inert), then the route PR. CI-enforced by `.github/workflows/security-boundary-isolation.yml`.

**Deploy & migrations** (`checkin-app/docs/`)
- `DEPLOY_MIGRATION_ORDER_OF_OPERATIONS.md` — infra rules + order of operations for schema migrations vs. deploys (read before writing a migration); `.claude/skills/migration-safety/` fires this as a checklist whenever a migration is being built.
- `MIGRATION_COALESCE_FLOW.md` — the pre-release migration-coalesce policy + script (`scripts/coalesce-migrations.ts`), the manual migration-count policy, and the dev/prod ledger-reconcile procedure.
- `PROGRAM_CAPACITY_AND_SCHOLARSHIPS.md` — single-pool Shopify capacity model + the scholarship hold-ledger state machine (read before touching `Program`/`ProgramParticipant` capacity or payment-plan logic).

**Subprojects** (each has its own `README.md`)
- `client/` — the Raspberry-Pi kiosk client (Python).
- `packages/*` (e.g. `monitoring-db`, `pg-test-harness`, `telemetry`), `layers/prisma-runtime/`, and the Lambda `*-function/` dirs (`s-read-function/`, `s-replay-function/`, `monitoring-relay-function/`, `monitoring-watchdog-function/`) — see the README in each; `s-read-function/` also has `MONITORING-PRD.md` + `FUTUREWORK.md`.
