# Auth consistency analysis — why `withAuth()` is only a "half rule"

**Date:** 2026-06-29 · **Last updated:** 2026-07-22 (verified against the live tree)
**Scope:** `checkin-app/src/app/api/**/route.ts` (101 route files) and the auth/authorization
layer (`src/lib/auth.ts`, `src/lib/auth-options.ts`, `src/lib/authClaims.ts`, `src/security/*`).
**Status:** single source of truth for the auth/authorization consolidation. It supersedes and
retires `checkin-app/src/security/SCOPE_BINDINGS_MIGRATION.md` (branch `claude/stoic-cohen-803161`),
imported in full as §7 below; that standalone file has since been deleted, so there is one plan, not two.

> ### ✅ Verification 2026-07-22 (against the live tree) — the security frontier is CLOSED
> Confirmed in `checkin-app/src/security/*`:
> - **Step 3 (the former "live frontier") is landed.** Fee is unbound (all-`public`), `RSVP` is
>   re-bound on `eventId → Event.programId` via the new `eventIdsInScopePrograms` context set, bare
>   `id` is gone from `SCOPABLE_FIELDS`, `AuditLog` is bound (`their_own:actorId`), and all registered
>   routes declare `returns:`. `tests/security/scopeValidators.test.ts` now asserts
>   `validateBindings(...) === []` **and** `validateRouteGrants(allRoutes(), …) === []` over the real
>   registry — **the CI gate is green and wired.**
> - **`handler()` adoption is 14 routes** (was 7). **`getServerSession` is down to 1 production route**
>   (`auth/dev-personas`; `shop/tools` now uses `withAuth` and mentions `getServerSession` only in a
>   comment), matching the DoD target. **All four front doors exist**:
>   `withAuth`, `withCron` (`cronAuth.ts`), `withWebhook` (`webhookAuth.ts`), `withKiosk` (`kioskAuth.ts`).
> - **`programs/[id]` GET is query-shaped** (§5.1a leak closed, #575). **`certifier` is a first-class
>   `Authorize` term** in `core.ts` (§9.1 "Option A" landed).
> - **The Step-7 drift-guard is ALSO landed**: `tests/security/routeAuthDrift.test.ts` — the static
>   front-door scan (no raw `getServerSession`/`authOptions` outside an allowlist, no `prisma` route
>   without a sanctioned wrapper) **including the §11 edge-include rule** — is green and runs in the
>   default jest/CI suite. The §10 relation-hop IDOR negative tests exist too
>   (`eventAttendanceAPI` / `eventRSVPAPI` / `authzOwnershipBoundary` integration tests).
>
> The remaining open work is Steps 5–6 (backfill the rest, collapse `withAuth`→`handler()`). Steps 5–6
> status below was **not** re-verified line-by-line beyond the counts above.

> ### ⚠️ Errata (2026-07-02, post-#708) — `Participant` → `Person` rename
> **#708** (`1c5358a5`) renamed Prisma model `Participant` → `Person` and row field `participantId` →
> `personId`, repo-wide. This document predates it and is **not** rewritten to match, so every
> `Participant` **model** name and `participantId` **row-field** literal below — including the §7.4
> table — reads as `Person` / `personId` in live code. `src/security/scopeBindings.ts` (CODEOWNERS-gated)
> is authoritative over any table here. **Not** renamed by #708: the `participantId…` **context keys**
> (e.g. `participantIdsInScopePrograms`) and the `ProgramParticipant` / `ProgramVolunteer` models.
> Historical references (e.g. the #564 `userId → participantId` rename) are left verbatim.

> ### Current state (2026-06-30) — most of the plan is MERGED
> Migrations #1, #2 and plan Steps 1–2 landed on `origin/main` as **#568–#573**:
>
> | PR | what | plan item |
> |---|---|---|
> | #568 | `withCron` / `withWebhook` | Migration #1 (session-less half) |
> | #569 | `getServerSession` → `withAuth` | Migration #1 (P0-B2; getSession **20→2**) |
> | #570 | `withKiosk` HOF + `scan` | Migration #2 |
> | #571 | program-scoped reads → `handler()` | Step 1 (program family) |
> | #572 | `payment-plans` + `shop/members` → `handler()` | Step 1 (remainder) |
> | #573 | `scopesHeld` switch → `SCOPE_BINDINGS` (S0–S2) | Step 2 |
> | #574 | drop dead Fee/RSVP field refs | Step 3 Blocker 1 ✅ |
> | #575 | gate program roster from anonymous callers | §5.1a (P0 leak) ✅ |
> | #576 | RSVP program-lead scope via `eventId` | RSVP capability ✅ |
> | #577 | drop bare `id` from heuristic + bind `AuditLog` | Step 3 Blocker 2 ✅ |
> | #578 | wire scope validators as a green CI gate | Step 3 Blocker 3 ✅ — **gate LIVE** |
> | #579 | denied gate on program-edit + certify writes | GAP-1 ✅ |
> | #580 | remove `getServerSession` from API routes | Step 7 phase 1 ✅ |
>
> Leaks closed (top-10, `programs/[id]`); validator gate LIVE (#578); GAP-1 closed (#579);
> `getServerSession` gone from routes except sanctioned exceptions; optional-session reads use
> `getOptionalSessionUser`. The Step-7 drift-guard CI check is **landed**
> (`tests/security/routeAuthDrift.test.ts` — fails any route importing `getServerSession` outside the
> allowlist or calling `prisma` without a sanctioned wrapper; the class that once re-grew 2→6 is now
> gated), and the §10 relation-hop IDOR negative tests are in
> (`eventAttendanceAPI`/`eventRSVPAPI`/`authzOwnershipBoundary`). Everything remaining (Step 5
> backfill, Step 6 collapse, derive hook, §11) is cleanup/design, not security.

**Refs analyzed (now merged):**

| label | ref → PR | one-line |
|---|---|---|
| baseline | `87cc322` | pre-campaign main this analysis started from |
| chaum | `claude/beautiful-chaum-e9a988` → **#569** | collapse session-web routes onto `withAuth` (P0-B2) |
| spence | `claude/wizardly-spence-ef9430` → **#568** | explicit `withCron`/`withWebhook` |
| stoic | `claude/stoic-cohen-803161` → **#573** | declarative validated scope bindings (implemented S0–S2) |
| funny-hugle | `claude/funny-hugle-f78899` → **#571** | program reads → `handler()` |
| affectionate-neumann | → **#573** | the S0–S2 port that surfaced the ROW_SCOPE_KEY / Fee-RSVP findings |

> spence is branched off an older main, missing ~12 commits (the `is`-prefix rename #562,
> Person=Participant #564, the P0-B3 `authenticateRequest`→`withAuth` migration #565); its raw diff is
> mostly rename noise. Its real contribution is one commit, isolated via `merge-base..spence` (10 files:
> 6 cron + 2 webhook + 2 new wrapper libs). The prior audit referenced in the task
> (`docs/codebase-audit-2026-06-29.md`) is **not committed to any ref**; branch/commit names (P0-B2,
> P0-B3) confirm a coordinated "P0-B" campaign against auth sprawl, reconstructed here from the code.

---

## TL;DR

`withAuth()` is a half rule not because it is half-adopted, but because it expresses only **half of
authorization**: it does **admission** (logged-in, non-denied session? optionally: does the caller hold
one of these *global* role flags?) and nothing else. Every endpoint whose authorization depends on the
**row** — *this* household/program/event, the caller's *own* record — cannot say so through `withAuth`,
so it admits with an empty `withAuth({})` and re-implements the real check by hand in the body.

**49 of 63 `withAuth` call sites pass no roles at all** (`src/lib/auth.ts:69`) — pure "is-logged-in"
gates with the actual authorization hand-rolled inline. The exceptions (`getServerSession`,
`authenticateRequest`, cron, webhook) are *mostly the same pattern in older clothes*.

The single rule the codebase is reaching for already exists: **`handler()`** (`src/security/handler.ts`),
the registry-driven runtime that does admission **and** row-scoped field stripping. `withAuth` is the
stopgap, not the target. (7 routes used `handler()` at analysis time; **14** as of 2026-07-22.)

---

## 1. ROOT CAUSE — why routes escape `withAuth`

Per-file mechanism census on `main` (101 route files; labels are multi-valued where a file mixes
mechanisms across HTTP methods):

| mechanism | files | bucket |
|---|---:|---|
| `withAuth()` | 63 | the rule |
| `getServerSession()` hand-rolled | 20 | **(c) drift** |
| `handler()` (5 pure + 2 mixed w/ withAuth) | 7 | **(b) principled** |
| cron `requireCronSecret` | 6 | **(a) session-less** |
| webhook HMAC/secret | 2 | **(a) session-less** |
| `authenticateRequest()` direct (`scan`) | 1 | **(b) principled** |
| genuinely unguarded / NextAuth mount | 4 | **(a) session-less / public** |

> Methodology caveat for re-runs: a naïve `withAuth(<[^>]*>)?\(` regex silently drops
> `withAuth<{ params: Promise<{ id: string }> }>(` generics (nested `>`) into a false "unguarded"
> bucket, and a single-quoted `from '@/security` grep misses every `handler()` route. Both bugs were
> hit and corrected; the numbers above are post-correction.

### (a) Legitimately session-less or public — 12 files, principled

No session by nature; `withAuth` would be wrong, not missing.

- `cron/{membership-renewals,nightly,pending-participants,post-event,reminders,trusted-adult-expiry}` —
  all six guard via `requireCronSecret(req)` (`src/lib/cronAuth.ts`), a `Bearer $CRON_SECRET`
  timing-safe compare.
- `webhooks/shopify`, `webhooks/zoho` — HMAC over the raw body. No cookie, no session.
- `auth/[...nextauth]/route.ts` — the NextAuth mount (`NextAuth(authOptions)`).
- `health/route.ts` — liveness probe.
- `system-status/kiosk-version/route.ts` — returns the git SHA so kiosks know when to reload.
  Unauthenticated by design (minor: `execSync("git rev-parse HEAD")` leaks the commit SHA;
  info-disclosure only, no PII).
- `programs/[id]/public-register/route.ts` — public sign-up form. Unauthenticated by design (no account
  exists yet); defended with `rateLimit` + `rateLimitEmail` instead of a session.

### (b) Needs something `withAuth` cannot express — 8 files, principled

- **`handler()` routes (7):** `directory/board`, `membership-ops/applications`, `membership/reviews`,
  `profile`, `safety/trusted-adults`, `trusted-adults/mine`, `trusted-adults/operational`
  (`src/security/registry.ts`). Each returns **PII across households** with **role- and row-dependent
  field visibility** — e.g. a background-check reviewer sees applicant parents' names+emails
  (`everyones:pii`) but not internal notes; a keyholder sees a trusted adult's contact (`personal`) but
  not the family's board context (`pii`). `withAuth` has no field-stripping, so these *must* use
  `handler()`. `profile` and `membership/reviews` are **mixed files**: the read uses `handler()`, a
  sibling mutation uses `withAuth`.
- **`scan/route.ts` (1):** the kiosk check-in/out endpoint. Calls `authenticateRequest(req, rawBody)`
  directly because it is **multi-actor** (kiosk signature *or* session) **and** the kiosk signature is
  an HMAC over the request **body**. `withAuth` calls `authenticateRequest(req)` with **no body**
  (`src/lib/auth.ts:80`), so it structurally cannot authenticate a signed-kiosk request. A real
  `withAuth` gap, not drift.

### (c) Pure drift / age — 20 files, accidental

The 20 `getServerSession()` routes: all of `attendance/*`, `events/*`, `programs/*` (the session-web
CRUD surface), plus `finance-ops/payment-plans`, `shop/members`, `shop/tools/[id]`, `auth/dev-personas`.
They hand-roll `getServerSession(authOptions)` → `if (!session) 401` and do per-row authz inline. There
is **no capability here `withAuth` lacks** — they predate the rule. The bucket **chaum** converts (§3);
the fix is mechanical and changes no behavior.

**Verdict:** the exceptions are **principled at the edges and accidental in the middle**. The
session-less (a) and field-stripping/kiosk (b) buckets are real and permanent in *some* form; the
20-file (c) bucket is pure age and is already being deleted.

---

## 2. WHAT `withAuth` CANNOT DO — and what the inline code reaches for

`withAuth` (`src/lib/auth.ts:69-100`) expresses exactly two things:

1. **Admission:** reject unauthenticated/denied-household (401), reject kiosk unless `allowKiosk` (403).
   The denied-household lockout (`auth.ts:50`, mirrored in `assignParticipantClaims`, `authClaims.ts:28`)
   is its one genuinely valuable, hard-to-reproduce feature.
2. **A flat global-role OR-list:** `roles: ['isSysadmin', 'isBoardMember']`, checked as
   `roles.some(r => user[r] === true)` (`auth.ts:90-96`). These are **global JWT flags**.

It has **no** notion of:

- **per-field sensitivity** (PII/internal/personal stripping) — `handler()` has it (`stripBag`,
  `handler.ts:113`; `fieldVisible`, `core.ts:218`);
- **per-row scope** — "their own", "their household", "a participant in a program they lead/core-vol",
  "a current visitor". `handler()` models these as `Scope` (`core.ts:43-53`) and resolves per row
  against a prefetched `CallerContext` (`access-resolvers.ts:20-60`);
- **multi-actor entry** with body-bound signature auth (the `scan` case).

The smoking gun: **49/63** `withAuth` sites pass no roles. The recurring shape: admit anyone logged in,
then hand-derive the real rule (e.g. `trusted-adults/[id]/withdraw` admits, then narrows
`auth.type !== "session"` only for TS and calls `withdrawTrustedAdult(id, auth.user.id)` where the REAL
authz lives; `events/[id]` computes `isLeadMentor`/`isCoreVolunteer`/`isSysAdminOrBoard` inline and
`403`s). That inline computation is **exactly what `buildCallerContext` already centralizes** for
`handler()` routes — `programsLed`, `programsCoreVolIn`, `householdIdsInScopePrograms`
(`access-resolvers.ts:25-31`). The 49 admission-only routes are **re-deriving, by hand and per route,
the context `handler()` computes once.**

> **Why `withAuth` is used empty with enforcement done later:** because the endpoint's authorization is
> *resource-scoped*, and `withAuth`'s only declarative knob is *global role flags*. The moment the rule
> is "the owner, or a lead of the program this row belongs to, or an admin," there is no way to say it
> in `withAuth`'s options, so the author writes `withAuth({})` to get the session + denied-gate and
> writes the real check in the body. The empty call is the **type signature admitting it has nothing to
> offer** for the ~78% of endpoints that are resource- rather than role-scoped. The recurring inner
> `if (auth.type !== 'session')` is not a second check — with `allowKiosk` unset `withAuth` already
> guarantees a session; that line only narrows the `AuthResult` union so TS lets you read `auth.user`.

`withAuth` is a session-admission shim; `handler()` is the policy engine. The codebase's problem: it
adopted the shim widely and the engine narrowly.

---

## 3. BRANCH COMPARISON — three complementary takes, not competing

The two branches attack **different buckets** of §1 and barely overlap. With what `main` merged they
form one migration.

- **`main` (merged): `authenticateRequest` → `withAuth` (P0-B3, #565).** `87cc322` converted the
  admin-web routes off direct `authenticateRequest`, leaving one principled route (`scan`). The campaign
  is already one step in.
- **chaum — bucket (c): `getServerSession` → `withAuth` (P0-B2, #569).** Converts **all 20** routes;
  zero `getServerSession` remain. Net −105 lines; per-row authz copied **verbatim** into the body. Its
  effect on the half-rule: it adds 20 more empty `withAuth({})` sites (pool 49 → 69). It **centralizes
  admission and entrenches scattered authorization** — a correct, low-risk consolidation that makes the
  inconsistency *uniform* (one admission path, one denied-gate) but is **not** a redesign.
- **spence — bucket (a): `withCron` / `withWebhook` (#568).** Two HOFs shaped like `withAuth`
  (`cronAuth.ts`, `webhookAuth.ts`), each `guard → handler → top-level catch`. The cron routes already
  guard, so spence closes no hole — it converts repeated inline `requireCronSecret` into a wrapper a new
  route **cannot forget**. Its philosophy is the important divergence: session-less routes are a
  **legitimate, permanent category** deserving their own **first-class named wrapper**, not folded into
  `withAuth`. This generalizes to a **family**: `withAuth`, `withCron`, `withWebhook`, and `withKiosk`.

**Most coherent direction:** chaum is most immediately mergeable (deletes the worst bucket); spence has
the most coherent theory (name every actor class, one wrapper each, none can forget its guard).
**Neither touches `handler()`** — the deepest problem (authorization scattered inline across 69 routes)
is addressed by neither. Together they reach "one admission rule per actor class"; for "one
*authorization* rule" you need the `handler()` direction below.

---

## 4. RECOMMENDATION — one rule that actually holds

**Target: `handler()` is the rule; the `with*` wrappers are its actor-typed front doors.** One policy
surface (`src/security/registry.ts`) and a family of entry wrappers that all funnel into the same
admission + row-scope + field-strip pipeline:

1. **`handler()` becomes the default for every authenticated, data-returning route.** It already does
   what 69 routes hand-roll: admission (`resolveAccess`, `handler.ts:76`), role-view selection
   (`orderedView`, `handler.ts:88`), per-row scope resolution (`access-resolvers.ts`), field stripping
   (`stripBag`, `handler.ts:113`). The `Authorize` admission grammar (`core.ts:116-125`) already
   includes `self`, `household-member`, `household-lead`, `program-lead-mentor`,
   `program-core-volunteer` — the exact inline checks the empty-`withAuth` routes re-derive. Most inline
   `if (!isLeadMentor && ...) 403` blocks collapse to a one-line registry `authorize` + `orderedView`.
2. **Merge `withAuth` into `handler()` as a degenerate policy, not a parallel layer.** A route needing
   admission but no stripping is a registry entry with a permissive `orderedView` (the stripper becomes
   a no-op). Keep a thin `withAuth`-named export for ergonomics, but it should call `handler()`, not
   `authenticateRequest` directly. This removes "admit then hand-roll" at the root: nowhere to hand-roll,
   because the row scope is declared, not coded.
3. **Adopt spence's wrapper family for non-session actors as siblings sharing the runtime.** `withCron`,
   `withWebhook`, and a new `withKiosk` (for `scan`, carrying the raw body to the signature verifier —
   the one thing `withAuth` can't do, `auth.ts:80`) become the typed front doors for the (a) and
   multi-actor (b) buckets. They share the same `apiError`/catch envelope so "every response leaves
   through a wrapper" is literally true.
4. **`authenticateRequest` stops being a public entry point** — fine as the internal primitive `handler()`
   and the `with*` wrappers call. No route imports it directly once `scan` has `withKiosk`.

**Rule in one sentence:** every route is `export const METHOD = withX(policy, fn)` where
`withX ∈ {handler/withAuth, withCron, withWebhook, withKiosk}`, the `policy` is declared in the registry,
and no route body contains an `if (...) return 403`. A drift-guard test (the `defineRoute` registry
already throws on duplicates/unknown roles, `core.ts:162`) enforces it: a route calling `prisma` without
a registered policy fails CI.

> **Principled exception — relation-hop admission stays inline (learned from `events/[id]`).** The
> `authorize` grammar keys on the route's own `[id]` param. When admission depends on a relation the
> param does *not* name — e.g. `events/[id]`'s `[id]` is an *event* id but the gate is "lead of the
> event's *program*" — `resolveAccess`'s program-scoped cases can't express it, and teaching them would
> touch CODEOWNERS-gated `access-resolvers.ts`. Accepted resolution: the handler fn (having fetched the
> row) does that one relation-hop check and throws `forbidden()` inline. So the rule is really **"no
> *ad-hoc* authz in bodies"**: a `403` that exists *because the grammar cannot yet express a relation
> hop* is allowed, must be commented, and is a candidate to lift into `authorize` later. Distinguish it
> from a `403` that is un-migrated drift.

**Migration path (executable, ordered version is §9):**

| # | step | status |
|---|---|---|
| 1 | Admission rule per actor class — `getServerSession`→`withAuth` (chaum) + `withCron`/`withWebhook` (spence) | ✅ merged #569, #568 |
| 2 | `withKiosk` + convert `scan`; remove last direct `authenticateRequest` route import | ✅ merged #570 |
| 3 | **Security first:** strip PII on the highest-leak reads, already-bound ones immediately | ✅ largely merged #571, #572 |
| S | Scope-resolver switch → declarative `SCOPE_BINDINGS` — only to enable the validators (minimal; no library) | ✅ merged #573 (S0–S2) |
| 3v | The three CI validators incl. the route-grant ↔ binding-scope seam check | ✅ **green + gated (#578)** |
| 4 | Collapse `withAuth` into a degenerate `handler()` (§9 Step 6 — planned); drift-guard (§9 Step 7) | drift-guard ✅ landed (`routeAuthDrift.test.ts`) |
| — | Extract a shared security library/package | OUT OF SCOPE — §7.7 |

Steps 1–2 reach "one admission rule per actor class"; the rest reaches "one *authorization* rule". §9
sequences security-first — stop the leaks, then lock with validators, then cleanup; library extraction
is deferred and never on the critical path.

**What to reconsider, not refactor:**
- `scan` sharing kiosk + session on one endpoint is the only genuinely multi-actor route and is
  principled — but is *why* `authenticateRequest` is public. Give it `withKiosk`; do not generalize
  "multi-actor endpoints" — keep it a deliberate single exception.
- `system-status/kiosk-version` running `execSync("git rev-parse HEAD")` unauthenticated is a smell.
  It already prefers `VERCEL_GIT_COMMIT_SHA` — drop the shell fallback.
- Mixed-mechanism files (`profile`, `membership/reviews`) should not exist post-migration — once
  `withAuth` is a degenerate `handler()`, both methods register policies.
- The 20-file `getServerSession` bucket should never have drifted. The lasting fix is not the conversion
  but the **drift-guard test** (Step 7); without it, bucket (c) regrows.

---

## 5. RISKS of the current half-rule state

Ranked by likelihood of a *real* authz bug (authorization is hand-written in 69 route bodies, no central
enforcement):

1. **Missing field-stripping on PII (highest).** Only 7 routes strip fields; every other route emits
   **whatever the Prisma query selected**. A `withAuth` route that over-`include`s a relation leaks PII
   with no backstop — there is no `stripBag` in the `withAuth` path at all. The `events/[id]` GET comment
   admits it: *"Without this gate any authenticated user could harvest roster PII by enumerating
   sequential event IDs."* The next over-broad `include` on a route whose author forgets the gate is an
   unbounded PII leak — the most likely place a real breach originates, and exactly what `handler()`
   prevents.

   > **1a. Association/existence leaks — a class `handler()` stripping CANNOT fix.** Field stripping
   > protects *sensitive-tier fields*. It does nothing when the leak is the **existence of an
   > association** whose identifiers are `public`-tier. A `ProgramParticipant`/`RSVP`/`Visit` row simply
   > *existing* reveals "person X is enrolled in / attending program Y," and `Participant.name` is
   > **`public`** — so the stripper leaves it. The tier model tiers *fields*, not the *existence of a
   > row*. Only **admission-gating** (who may call) or **role-shaping the query** (don't `include` the
   > association for unauthorized callers) protects these. Two instances, **both now closed**:
   > - **`events/[id]` GET:** fail-closed, staff-only — the handler resolves event→program and does the
   >   lead/core-vol/admin check inline (throws 403). Stripping remains as defense-in-depth on staff
   >   tiers; a stripper test pins the leak (`name` survives strip) as the regression anchor.
   > - **`GET /api/programs/[id]`:** was `authorize: 'public'` + `anyone → ['public']` returning the
   >   enrollment roster to unauthenticated callers (stripping can't help — names are public). **Fixed
   >   in #575 by query-shaping** (verified 2026-07-22): program metadata stays public, but the
   >   `participants`/`volunteers` associations are only `include`d for staff/enrolled callers;
   >   `_count.participants` (spots-remaining) stays public. This was the highest-severity item in this
   >   document — now closed.

2. **Inconsistent denied-household enforcement (high).** The lockout is enforced in `authenticateRequest`
   (`auth.ts:50`) and the JWT claims (`authClaims.ts:33-39`); every `withAuth` route inherits it. A route
   on bare `getServerSession` reads `session.user` directly and **does not pass through the `denied`
   short-circuit** — a denied household doing a **write** through an `attendance/*` or `events/*`
   `getServerSession` route is the concrete hazard. **chaum closes this** by routing all 20 through
   `withAuth` — a security fix, the strongest argument for landing it promptly.

3. **IDOR via hand-rolled row checks (high).** With 69 routes each implementing their own "is this my
   row?" test, the failure mode is a route that **admits** (`withAuth({})`) but **forgets the row check**.
   The trusted-adult withdraw/renew routes have explicit negative tests for exactly this (`fd192fc`,
   "assert no mutation after IDOR 403") — the team already found at least one. A declared
   `authorize: 'self'`/`'household-lead'` cannot be forgotten the way an inline `if` can.

4. **Kiosk-vs-session confusion (medium).** `scan` is the only route branching on `auth.type`, by hand
   after a direct `authenticateRequest(req, rawBody)`. The local-dev kiosk fallback (`auth.ts:32-41`)
   treats a cookie-less request as kiosk when no signing key is configured — correct on
   `CHECKIN_ENV=local`, disabled on the public dev box. Well-commented and contained to one route, but if
   any other route copies `allowKiosk` without the body-signature requirement it would admit kiosks it
   cannot authenticate. A single `withKiosk` wrapper removes this footgun.

5. **Cron/webhook guards uniform today but unenforced (low).** All six cron routes guard, both webhooks
   verify — but nothing *makes* a new one do so. spence's wrappers convert convention to structure.
   Rising with every new background job.

---

## 6. The two layers, and the seam between them

The registry work (§4, §9) and the scope-bindings refactor (§7) are **different layers of the same
pipeline**; understanding the seam is what makes the combined plan safe.

| | Registry layer (§4/§9) | Scope-resolver layer (§7) |
|---|---|---|
| File | `registry.ts` route specs + route bodies | `access-resolvers.ts` → `SCOPE_BINDINGS` |
| Question | "which `scope:tier` grants does this **route** hand out?" (`orderedView`) | "given a **row**, which scopes does the caller hold?" (`scopesHeld`) |
| Operand in the stripper | the **tokens** argument | the **scopes** argument |

The stripper multiplies them: `fieldVisible(tier, tokens, scopesHeld)` (`core.ts:218`). A field reaches
the wire only if the route *granted* a `scope:tier` token **and** the caller *holds* that scope on that
row. Neither layer is sufficient alone, and they are authored in different files by (potentially)
different people. Three consequences drive the plan:

1. **The scope refactor (§7) makes the registry backfill (§9) safer.** When §9 registers ~60 new routes,
   each newly routes a model through the stripper. If a model resolves to only `everyones` (binding
   forgotten), a `their_program_participants:pii` grant silently resolves to nothing — the lead sees an
   empty roster, looks like a backend bug, no alarm (fail-safe). §7's coverage validator is the guard.
   **Do §7 before the bulk of §9.**
2. **Model coverage is a *moving* line — track it with one queue, not a permanent list.** A model
   admin-only today may become household/program-scoped when a route ships. §7.5.1 handles this with **no
   permanent opt-out list**: structurally un-scopable models are *auto-exempt* by `isScopable()`, "never
   leaves" content is tiered `secret`, and the only hand-maintained set is `OPT_OUT_PENDING_ROUTE` — a
   work queue each PII route drains by moving its model into a real binding in the same PR.
3. **Neither validator guards the seam — so this plan adds a third (§8).** §7's validator proves every
   sensitive model is *bound*. It does not prove every `scope:tier` token a route *grants* is *resolvable*
   on the model that route returns. That cross-check lives between `registry.ts` (grants) and
   `SCOPE_BINDINGS` (resolution); §9 populates it 60×.

---

## 7. Scope-resolver refactor — declarative, validated `SCOPE_BINDINGS`

> Imported from `SCOPE_BINDINGS_MIGRATION.md` (branch `claude/stoic-cohen-803161`, which this document
> retires) and **re-prioritized**: the source framed this as a step toward a shared, reusable security
> library for a future monorepo. **That is demoted — the priority is the security/validation value, not
> building a library.** Package extraction is an explicit follow-on (§7.7), out of scope. Corrections
> folded in: the `Visit` field-name fix (§7.5) and removal of `OPT_OUT_PERMANENT` for auto-exemption +
> a single pending queue (§7.5.1). Phases renumbered S0–S3.
>
> **Implemented (S0–S2, #573).** The spec code that filled this section is now live in
> `checkin-app/src/security/scopes.ts` (the engine + validators) and `scopeBindings.ts` (the data table),
> both CODEOWNERS-gated and better-commented than the sketches below. This section is kept for the
> *rationale and findings*; the files are authoritative for the code.

**Why this is security, not refactoring-for-its-own-sake:** the three CI validators that catch real
leak classes — field-typo, forgotten-model, and the §8 route-grant seam — can only run against
*declarative* binding data. Today `scopesHeld()` was an opaque `switch`, so none were possible.
Converting the switch to a data table is the **minimum** needed to make the security checks exist. No
split into a shared package, generic engine, or app-agnostic substrate — that is §7.7.

### 7.1 Problem

Per-row scope resolution lived in `scopesHeld()` (`access-resolvers.ts`) as a ~110-line
`switch (modelName)` tangling **plumbing** (seed `everyones`, null-guard the row, add-and-return) with
**bindings** (schema-shape knowledge like "scope `their_households` is held on `Participant` when
`row.householdId === ctx.householdId`"). Two security failure modes fall out, both silent wrong access:

1. Bindings are **opaque code**. `row.householdId` is a property access on `Record<string, unknown>`, so
   a typo (`row.householdID`) compiles, returns `undefined`, silently never grants the scope, and ships.
   Over-restriction is invisible — no test/type-error/build-failure catches it. (The source proposal's
   own `Visit.departed` typo, §7.5, is a live example.)
2. A model added to the schema but **forgotten** in the switch silently gets only `everyones`. No
   coverage check exists — a sensitive model can sit reachable only through admin views by accident,
   indistinguishable from by-design.

Neither can be caught while resolution is imperative code. **Making it declarative data is what lets CI
check it** — the whole reason it is in this security plan.

### 7.2 Goal / non-goals

**Goal (security).** Make scope resolution *checkable in CI*: convert the imperative `switch` to a
declarative `SCOPE_BINDINGS` table interpreted by one local function, so three validators can run —
every `field:` in a binding **exists** on that model; every sensitive model is **bound or auto-exempt**
(§7.5.1); and (§8) every scope a route *grants* is *resolvable* on what it returns. Two human-review
questions become mechanical build checks.

**Non-goals.** No change to the tier vocabulary (`public/pii/personal/internal/secret`), the
Role/Token/`orderedView` grammar (`core.ts`), or the route specs (§9's job). No change to runtime
*behavior* — phase S1 enforces this with an equivalence test before any old code is deleted. **No library
extraction / shared package / generic-per-app home split** — all §7.7. Everything lands inside
`checkin-app/src/security/`.

### 7.3 Target architecture (implemented in `scopes.ts` + `scopeBindings.ts`)

One home, kept deliberately local: `Match` type + `evalMatch` interpreter + `makeScopesHeld(bindings)` +
`validateBindings` / `validateRouteGrants` in `scopes.ts`; `SCOPE_BINDINGS` + `ROW_SCOPE_KEY` +
`OPT_OUT_PENDING_ROUTE` in `scopeBindings.ts`; `CallerContext` + `buildCallerContext` unchanged in
`access-resolvers.ts`. `makeScopesHeld` is a factory only to keep table and engine in separate files for
testability — **not** to support multiple apps.

**Match vocabulary** (proven complete against all 14 switch cases):

- `{ field, eqCtx }` — `row[field] === ctx[scalar]`, where `scalar ∈ {selfId, householdId}`.
- `{ field, inCtx }` — `ctx[set].has(row[field])`; an array of sets is an OR (models the two
  `programsLed || programsCoreVolIn` disjunctions). Sets:
  `programsLed, programsCoreVolIn, participantIdsInScopePrograms, householdIdsInScopePrograms,
  eventIdsInScopePrograms, activeVisitorIds`.
- `{ flag }` — `ctx[flag] === true`, where `flag ∈ {isKeyholder, isKiosk}`.
- `{ field, isNull: true }` — `row[field] == null`.
- `{ all: [...] }` — AND. The only combinator needed (every compound case is an AND); `any` is additive.
- `{ custom: predicate }` — escape hatch. **None of checkin's 14 cases need it**; custom entries skip
  validation, so the engine `console.warn`s them as audit-flagged.

**Key invariants the interpreter preserves** (all live in `scopes.ts`):
- `eqCtx`/`inCtx` carry a `typeof v === 'number'` guard encoding the old switch's `!== undefined` checks,
  so an anon caller (`selfId === undefined`) never spuriously matches a row whose field is also absent.
- **ROW_SCOPE_KEY fail-closed** (verified live: `{ EmergencyContact: 'householdId' }`): a row-scoped
  model whose scope key is absent/non-numeric returns `{}` (NO scopes), **not** `{everyones}`, so a
  missing selected column can never let an `everyones:*` (admin) view leak a whole row. The §7.3 stoic
  sketch dropped this; the live switch (and `stripper.test.ts:264` + the equivalence test) require it —
  it is carried through `makeScopesHeld` via a `rowScopeKeys` param.
- `everyones` is seeded on every present row; a null/non-object row fails closed for row-scoped models
  and gets the broad scope for others. The signature `scopesHeld(modelName, row, ctx)` is **preserved**,
  so `stripper.ts` and the contract tests are unchanged.

**Validators** (`validateBindings`, `validateRouteGrants` in `scopes.ts`):
- **(a) field-existence** — every `field:` in a binding must exist in the model's `classifications` map
  (the typo catcher); `custom` matches log a warning.
- **(b) coverage** — every model with a non-`public`/non-`secret` field must be `in bindings`,
  auto-exempt via `isScopable()`, or in `OPT_OUT_PENDING_ROUTE`; else it errors (the forgotten-model
  catcher). `isScopable(model)` is true iff the model has a field in `SCOPABLE_FIELDS`
  (`householdId, programId, personId, userId, actorId, createdById`). **Bare `id` is deliberately
  excluded**: `id` is a scope field only for `Person`/`Household`/`Program`, which are always bound and
  skipped *before* `isScopable` runs; including `id` would make every log/settings table (all have an
  `id`) falsely "scopable" and defeat auto-exemption. Keep `SCOPABLE_FIELDS` in sync with the
  `CtxScalar`/`CtxSet` FKs. If "never leaves, even to admin" is intended, tier the field `secret` — not
  opt-out. Structural FK/id columns are always emitted into `classifications` (at `public`), so
  field-existence validation works for them.

### 7.4 Full binding port — implemented in `scopeBindings.ts`

All 14 model cases were ported 1:1 from the switch and now live in `SCOPE_BINDINGS`
(`scopeBindings.ts`), which is authoritative. The corrections that shaped the port are §7.5. Notable
bindings (post-#708 live names): `Person` (`their_own` id=selfId, `their_households` householdId,
`their_program_participants` id∈participantIdsInScopePrograms, `keyholders`, `all_current_visitors`);
`EmergencyContact` (row-scoped `their_households` + `their_program_households`, ROW_SCOPE_KEY
fail-closed); `ProgramParticipant`/`ProgramVolunteer`/`Event`/`Program` (program-lead/core-vol);
`RSVP` (`their_own` + `their_program_participants` via `eventId`); `Visit` (`their_own` +
`all_current_visitors` keyholder∧departedAt-null); `TrustedAdult`/`TrustedAdultReview`
(household + program-household + keyholders); `AuditLog` (`their_own:actorId`, admin-only by tier-grant).

### 7.5 Corrections folded in from the analysis

- **`Visit` field name.** Source wrote `{ field: 'departed', isNull: true }`; the schema field is
  **`departedAt`** (`schema.prisma:764`; the live switch already used `row.departedAt == null`). This is
  the exact typo class the validator catches — a careful author still tripped it, the strongest argument
  for landing **S3 (the validator) before any large hand-authored binding work**.
- **`ToolStatus`.** Source wrote `field: 'userId'`; #564 renamed `ToolStatus.userId → participantId`
  (then #708 → `personId`). Live verified.
- **`RawBadgeLog`, not `RawBadgeEvent`.** The stoic table wrote `RawBadgeEvent`; the live model is
  **`RawBadgeLog`**.
- **`Fee` / `RSVP` grouped-case fields.** The switch grouped `ProgramParticipant | ProgramVolunteer |
  Fee | RSVP` and read *both* `programId` and `participantId`. But **`Fee` has no `participantId`** and
  **`RSVP` has no `programId`** — those reads were inert on real rows, but a verbatim binding references
  non-existent fields and the field-existence validator flags them. Narrowed: `Fee` → unbound
  (all-`public`, needs no binding); `RSVP` → `their_own` only, then **re-bound** with a real
  program-lead grant via `eventId → Event.programId` (`ctx.eventIdsInScopePrograms`, a new context set)
  — a deliberate behavior change, not the dead switch read. *The equivalence test caught the dead reads
  on the first port — fixed the binding, not the test.*
- **`EmergencyContact` is already bound — the doc was stale.** The live switch binds it (`their_households`
  via `householdId`, ROW_SCOPE_KEY fail-closed). It is a Step-1 already-bound read (§9), **not** pending.
- **`ROW_SCOPE_KEY` fail-closed** must be carried into the engine — see §7.3.

#### 7.5.1 No `OPT_OUT_PERMANENT` — auto-exempt the un-scopable, queue the rest

A hand-maintained permanent opt-out list is where mislabels hide. Of the source proposal's 11 entries,
three had no sensitive fields at all (`CorporationLead`, `Tool`, `SystemMetricLog`); two were actually
scopable and route-deferrable (`Corporation` has `leads→participantId`, `VolunteerDesignation` a
`createdById`); and `AuditLog` has an `actorId` — "can a member see their own audit trail" is a real
product question, not a settled "never."

The honest principle: **the only thing warranting permanent exemption is a model that is *structurally
un-scopable* — sensitive fields but no foreign key by which any non-admin actor could own a row**
(`ErrorLog`, `DevLedger`, `BoardSettings`, NextAuth's `VerificationToken`). For those no `their_*`
binding is even expressible, and it is a **derivable fact, not a human assertion** — `isScopable()`
computes it and auto-exempts, logging each so a reviewer can challenge a wrong tier. Two rules collapse
the rest:

- **"Never leaves, even to admins" → tier the field `secret`** (already exempt, e.g.
  `VerificationToken.token`). Opt-out is for "leaves to admins only," not "never leaves."
- **"Admin-only by policy" is not opt-out.** A model can have a `their_own` binding and still be
  admin-only — bind the scope, tier the sensitive fields `internal`, and never grant `their_own:internal`
  on any route. `BackgroundCheckAttestation` is the test case: the participant *owns* the row but must
  not see the safeguarding notes → bind `their_own`, tier the notes `internal`.

That leaves one hand-maintained list — a **work queue** (`OPT_OUT_PENDING_ROUTE`) of sensitive, scopable
models whose scoped route is not built yet. A §9 migration moves each entry OUT of the set and INTO a
real binding, in the same PR shipping its `handler()` route. Done when the set is empty. (Live members
as of 2026-07-22, after the #708 rename surfaced `personId`-only models: `OrgMembershipProcess`,
`BackgroundCheckAttestation`, `Corporation`, `VolunteerDesignation`, `PaymentException`, `PersonRole`,
`BulkSendItem` — each documented in `scopeBindings.ts` with its current reader and the future
self-facing route that would earn it a binding. `EmergencyContact` is **not** here — already bound.)

Two decisions from the live port, both landed:
- **Drop bare `id` from `SCOPABLE_FIELDS`** (reasoning in §7.3): `field: 'id'` scoping lives in the
  bindings (bound, never reaching `isScopable`); the heuristic only judges *unbound* models where `id`
  is a bare PK. **Do not rename the `id` columns** (PK rename ripples through every FK). Left a
  `// ponytail: name-list heuristic; derive from schema FKs if it drifts` for a later structural version.
  Dropping `id` auto-exempts `BoardSettings`/`ErrorLog`/`SystemMetricLog`/`IntegrationErrorLog`/`DevLedger`.
- **`AuditLog` → bind `their_own:actorId`, admin-only by tier-grant control.** It has `actorId` so
  `isScopable` correctly calls it scopable; rather than a new opt-out set, apply the "admin-only by
  policy" rule. Coverage passes (bound); runtime stays admin-only because **no route grants
  `their_own:internal` on `AuditLog`** — only `everyones:internal` (admin) views see audit rows. The
  binding is runtime-inert today and future-proofs a careful "your own actions" view.

**Behavior is unchanged.** Every admin-only model stays admin-only: un-scopable ones via `isScopable`
auto-exemption, queued ones because no route grants a `their_*` token until §9 ships one.

### 7.6 Phasing (S0–S3, each independently shippable and reversible)

- **S0 — land the engine, unwired.** Add `Match`/`evalMatch`/`makeScopesHeld`/`validateBindings`
  (incl. `isScopable`)/`SCOPE_BINDINGS`/`OPT_OUT_PENDING_ROUTE` in new CODEOWNERS-gated files. Export as
  `scopesHeldNext`; nothing imports it; old `scopesHeld` untouched → no behavior change possible.
- **S1 — equivalence gate.** Contract test asserting `scopesHeldNext === scopesHeld` (set equality)
  across every model × caller persona × representative rows (personas from `npx tsx prisma/seed.ts`:
  anonymous, self-only member, household co-member, program lead, core volunteer, keyholder, board,
  sysadmin; rows: own / another's / in-program / out-of-program / active-visit / departed-visit). Green
  before S2.
- **S2 — flip + delete.** Point `stripper.ts` and the security tests at the new resolver (rename
  `scopesHeldNext` → `scopesHeld`, delete the old switch). Keep the S1 test as a regression guard.
- **S3 — turn on the validators.** Wire `validateBindings(...)` + the §8 validator as CI checks
  (assert zero errors). From here a field typo, forgotten sensitive model, or unresolvable route grant
  **fails the build**. **This is the payoff — landed as #578.**

### 7.7 Follow-on (OUT OF SCOPE) — extract a shared security library

The source proposal's larger ambition — lift the generic engine (`Match`, `evalMatch`, `makeScopesHeld`,
the validators) into a shared package so future apps inherit classification-enforcement + stripping — is
a **separate project, not in this plan.** Nothing in S0–S3 or §9 depends on it; it depends on nothing
here beyond "the engine is a clean function over a data table," which S0–S2 deliver as a side effect.
Defer until a second app needs it (YAGNI); the lift is mechanical because the generic/data seam is
already drawn. Ship the security checks and PII route migration first; package extraction never precedes
or blocks them.

---

## 8. The third validator — route-grant ↔ binding-scope (the seam check)

§7's validator proves every sensitive model is bound. It does **not** prove every `scope:tier` token a
route grants in `orderedView` is resolvable on the model(s) it returns. A registry entry can grant
`['programLeadMentor', ['their_program_households:pii']]` on a route whose returned model's binding has
no `their_program_households` scope → the stripper silently strips → the lead sees nothing. No existing
check fires, because the grant lives in `registry.ts` and the resolution in `SCOPE_BINDINGS`, and nothing
compares them.

**Blocker to writing the check:** routes did not *declare* the models they return — `handler()` inferred
them from the bag at runtime (`stripBag`). So each `RouteSpec` gained an optional
`returns?: readonly (keyof Models)[]`. The validator (`validateRouteGrants` in `scopes.ts`, implemented)
treats `returns === undefined` as `[]` and **skips** the route — un-migrated routes aren't checked yet,
and the check tightens automatically as each declares `returns`. For every route, every row-scoped scope
it grants must be resolvable on at least one returned model; `everyones` is seeded on every row and
skipped. **As of 2026-07-22 all 14 registered routes declare `returns`.**

What it catches that the other two miss:
- a route grants a scope the returned model doesn't bind → **silent over-restriction**, today invisible
  because it fails safe;
- the inverse smell — `returns: ['X']` but the handler returns model `Y` — is already caught at runtime
  by `stripBag`'s "bag key is not a known model" warning, promotable to a test.

§7 proves the resolver is honest about *rows*; §8 proves the routes are honest about *grants*; together
they close the loop the half-rule left open. `everyones`-tier grants (admin views) need no binding and
are skipped; the check bites only on row-scoped tokens (`their_*`, `keyholders`, `all_current_visitors`)
— exactly the set §9 introduces at scale.

---

## 9. Execution plan — ordered steps from the post-#1/#2 baseline

**Baseline:** Migration #1 (chaum + spence) and #2 (`withKiosk`/`scan`) landed. Every route enters
through `withAuth`/`withCron`/`withWebhook`/`withKiosk`; `authenticateRequest` has no direct route
callers; admission is uniform; **authorization is still hand-rolled inline in ~69 `withAuth` routes**,
and only 7 routes strip fields (14 as of 2026-07-22).

**Priority order is security-first:** (1) stop the active PII leaks, (2) lock them with CI validators,
(3) only then uniformity/cleanup. The scope-resolver conversion (§7) is included **solely because the
validators can't exist without it**. Library extraction (§7.7) never precedes or blocks any step.

> **STATUS 2026-07-22: Steps 1–3 are landed** (#568–#578; verified — see the top banner), and so is the
> Step-7 drift-guard (`routeAuthDrift.test.ts`). The live frontier has moved to Steps 5–6 (backfill the
> rest, collapse `withAuth`). Steps 1–3 below are kept for rationale.

### Step 1 — Ship the leak fix: already-bound PII reads ✅ *merged (#571, #572, #575)*

`GET /api/events/[id]` was the template: `defineRoute` with `returns: ['Event']`, inline
`isLeadMentor || isCoreVolunteer || isSysAdminOrBoard` moved into `authorize` + `orderedView`, body 403
deleted, strip test added (lead sees PII; non-staff stripped). Same shape rolled to the other
**already-bound** reads (no §7 dependency): `programs/[id]/eligible-participants`, `finance-ops/payment-plans`
(board/sysadmin → `everyones` view), `household/emergency-contacts` (`authorize: 'household-lead'`;
`EmergencyContact` bound via `their_households` + ROW_SCOPE_KEY). The sibling write routes
(`events/[id]/attendance`, `programs/[id]/participants`, `programs/[id]/volunteers`) are POST/DELETE-only
→ `withAuth`, no roster GET to strip. **`GET /api/programs/[id]` (the §5.1a highest-severity leak) fixed
in #575 by query-shaping** — already a handler route, so a query-shaping fix, not a migration: metadata
stays public, associations `include`d only for staff/enrolled callers.

> Corrections to the original top-10: (a) "trusted-adults (list)" is not a read route
> (`trusted-adults/route.ts` is POST-only); the trusted-adult *reads* (`mine`, `operational`) are
> already on `handler()`. (b) `shop/members` needed an authorize decision first — see §9.1.

#### 9.1 Decision — `shop/members` and the certifier `toolStatus` ✅ *Option A landed*

The certifier gate is a `toolStatus` (`level === 'MAY_CERTIFY_OTHERS'`), not a global `BusinessRole`.
**Option A (recommended, now landed): `certifier` is a first-class `Authorize` admission term** in
`core.ts` (verified 2026-07-22), backed by a `resolveAccess` predicate reading `toolStatuses`. This keeps
"all authorization is declared" and pays off across the shop surfaces. (Option B — split the route and
keep the certifier branch inline — was the fallback if A were blocked; not taken.) Separate from
admission: the **view**. `shop/members` returns every active member's `email` (pii) to a certifier;
`Person` bindings don't grant a certifier arbitrary members' pii, so the route grants `everyones` to that
role — **confirm** a certifier needs every member's email vs just `name` + a contactable handle. This is
the one Step-1 route where migration should *reduce* what leaks, not just declare the status quo.

### Step 2 — Stand up the validation substrate, minimal ✅ *merged (#573, S0–S2)*

Converted the `scopesHeld` switch to the declarative table (nothing more — no package). #573
(`affectionate-neumann`) implemented S0–S2 (S1 equivalence green) and carried the ROW_SCOPE_KEY
fail-closed guard the sketch dropped. It initially kept the literal Fee/RSVP port and pinned the
resulting field-existence errors as a "known finding" — cleared in Step 3.

### Step 3 — Make the validator gate green, then wire it ✅ *landed (#574, #576, #577, #578)*

The three blockers, all now cleared and verified in the tree:

- **Blocker 1 — Fee/RSVP bindings (#574, #576).** Dropped the dead `Fee.their_own:participantId` (Fee has
  no `participantId`) and `RSVP.their_program_participants:programId` (RSVP has no `programId`) — inert on
  real rows, so equivalence-preserving. `Fee` is now unbound (all-`public`); `RSVP` re-bound on the real
  `eventId → Event.programId` via `eventIdsInScopePrograms` (#576). *Intent preserved:* the RSVP
  program-lead view ("a lead sees RSVPs incl. `reminderSentAt:internal` for their program's events")
  needed the `eventIdsInScopePrograms` set added to `buildCallerContext` — done.
- **Blocker 2 — `id` out of `SCOPABLE_FIELDS`; `AuditLog` bound (#577).** With `id` present every admin
  log/settings table was falsely "scopable." Dropped `id` (auto-exempting the five FK-less logs/settings)
  and bound `AuditLog: { their_own: { field: 'actorId', eqCtx: 'selfId' } }`, admin-only by tier-grant.
- **Blocker 3 — `returns:` backfill (#578).** `validateRouteGrants` now guards `spec.returns ?? []` and
  skips undeclared routes (incremental coverage). All 14 registered routes declare `returns`. The
  load-bearing subset is the row-scoped granters (`profile`, `programs/[id]`, `events/[id]`,
  `eligible-participants`, `trusted-adults/mine`, `trusted-adults/operational`); `everyones`-only routes
  (`directory/board`, `membership-ops/applications`, `safety/trusted-adults`, `membership/reviews`) are
  hygiene only.

**Gate wired (#578):** `tests/security/scopeValidators.test.ts` now asserts
`validateBindings(SCOPE_BINDINGS, classifications, OPT_OUT_PENDING_ROUTE) === []` and
`validateRouteGrants(allRoutes(), SCOPE_BINDINGS) === []` over the real registry. A grant that can't
resolve now **fails the build** instead of silently over-restricting — the half-rule's
silent-over-restriction class is a build error.

### Step 4 — Finish any PII reads that need a *new* binding *(near-empty)*

`EmergencyContact` is already bound (moved to Step 1), so the only candidate is `notifications` — confirm
the returned model; if it returns only the caller's own rows (likely), a `self` authorize + `their_own`
binding covers it. Read-side done when the top-10 routes are migrated and `OPT_OUT_PENDING_ROUTE` drains.

### Step 5 — Backfill the remaining authenticated routes

Remaining surface (~36 `withAuth` reads + ~43 write-only). **None is a broadly-admitted cross-participant
leak** — those are done. Four parts, ordered by residual value; every migrated route gets `authorize` +
`returns` so the seam validator covers it.

**5a — admin/staff PII reads → `handler()` + `everyones` view *(backstop; RAW-ROW routes only).***
Reads gated to `isSysadmin`/`isBoardMember`/`isKeyholder` returning `name`/`email`/`dateOfBirth` with no
stripping backstop. Admission is already tight, so this guards against a *future* over-include. Template =
the `finance-ops/payment-plans` migration (#572).

> **⚠️ Hard constraint (from `task_b2fedecb`): `handler()` emits only *classified model fields* +
> relations. It silently drops *computed/derived* response fields.** The #572 template worked because
> payment-plans/directory/shop return **raw model rows**. Reads returning a **computed envelope** the
> frontend depends on **must not** be force-migrated — it would drop the computed fields and break the
> page:
> - `participants/search` → computed `isMember` + nested household shape.
> - `safety/emergency-contacts` → `isPresent`, back-compat `emergencyContactName/Phone`, per-contact
>   `invalid`, mapped participants/leads.
> - `admin/broken-households` → renamed `members` + `name || "Household #id"` fallback.
>
> **These three stay on `withAuth`** until the `derive` hook (Step 6). 5a's target is the RAW-ROW subset
> only (verify each returns model rows, not a computed shape). Likely candidates:
> `membership-audit/{unclaimed-households, households-missing-contact}`, `facility/{visits,badges}`,
> `membership-ops/households`. Verify-then-batch; do not assume payment-plans shape.

**5b — own-data reads → `handler()` + `self`/`their_own`.** `profile/{visits,onboarding-status}`,
`membership/{route,payment,renewal-status}`, `notifications`, `nav/todo-counts`, `programs/mine`,
`events/mine`. Self-scoped → low risk; convert for consistency.

**5c — role-gated writes → uniformity *(drift-guard payoff, not PII).*** The ~43 write-only routes
(`membership-ops/*`, `programs/[id]/{settings,publish,volunteers,…}`, `safety/*/{decision,override}`,
`trusted-adults/[id]/*`). They leak nothing on the wire — declare `authorize`, drop the inline 403s, add
`returns`. Lowest priority.

**5d — system/config reads → uniformity.** `system-status/*`, `settings/membership/*`, `admin/settings/*`.
Internal/admin data, minimal PII.

### Step 6 — Collapse `withAuth` into a degenerate `handler()` *(cleanup — BLOCKED on the `derive` hook)*

**Correction from 5a:** a permissive `orderedView` is **NOT** "stripper a no-op." The stripper emits only
*classified model fields* regardless of view tokens, so any `handler()` path drops a route's
computed/derived response fields. Many `withAuth` routes return computed envelopes (`isMember`,
`isPresent`, `invalid`, back-compat names). Therefore **`withAuth` cannot be collapsed into `handler()`
until `handler()` can host computed fields**.

**Prerequisite — a fail-closed `derive` hook:** `handler(endpoint, fn, { derive: (strippedBag, ctx) =>
extraFields })`, running **after** `stripBag` on **already-visible** data and merging into the envelope.
Fail-closed by construction: a computed field whose inputs were stripped can't be built, so it can't leak
(admin `everyones` views strip nothing, so derivation has all inputs). With it: envelope reads from 5a
can migrate, and the `withAuth`→`handler` collapse becomes safe. Without it, envelope routes stay on
`withAuth` permanently and "one admission path" is unreachable. **Decide this hook before committing to
Step 6.** After the hook: make `withAuth` register a permissive policy + call `handler()`; delete
`src/lib/auth.ts`'s `roles`/admission logic; `authenticateRequest` survives as the internal primitive.

### Step 7 — Lock it with the drift-guard *(✅ LANDED — preventive security)*

CI test that fails on any new `getServerSession` / `authenticateRequest` import outside the wrapper libs,
and on any route file calling `prisma` without a registered policy (extend the registry's
throw-on-unknown-role, `core.ts:162`, into a coverage test over `src/app/api/**`).

> **This was the single most valuable remaining item, and it is *security*, not cleanup — proven by drift
> having *already re-grown***. The doc once recorded 2 `getServerSession` routes; a later `origin/main` had
> **6**; GAP-1 (§10) was a re-grown instance of risk #2. New routes kept reaching for `getServerSession`
> because nothing stopped them. **Landed as `tests/security/routeAuthDrift.test.ts`** (verified green
> 2026-07-22): a static text scan over every `src/app/api/**/route.ts` enforcing (1) no raw
> `getServerSession`/`authOptions` outside a comment-justified allowlist, (2) any `prisma`-touching route
> enters through `withAuth`/`handler`/`withCron`/`withWebhook`/`withKiosk` (or a sanctioned public read),
> and (3) the §11 edge-include rule. As of 2026-07-22 `getServerSession` is down to **1 production route**
> (`auth/dev-personas`, allowlisted with in-file justification).
>
> **Refinement (`task_8659e031`): not all are mandatory-session.** *Writes* (`programs/[id]` PATCH,
> `shop/certifications` POST, `shop/tools` POST) → `withAuth({})` (also fixes GAP-1). But three are
> **optional-session** — legitimately serving **anonymous** callers, which `withAuth` would 401:
> `attendance` GET (kiosk + anonymous), `programs` GET (anonymous public catalog, test-asserted at
> `programsAPI.integration.test.ts:91`), `dev-personas` GET (dev login). The fix is a sanctioned
> **`getOptionalSessionUser()` in `lib/auth.ts`** built on the existing `authenticateRequest` (reusing
> the denied gate): `return auth.type === 'session' ? auth.user : undefined` — a denied household falls
> through to `undefined` → public-only, fail-closed. This completes the wrapper family:
> `withAuth`/`handler` (mandatory session) · `getOptionalSessionUser`/`authenticateRequest` (optional) ·
> `withCron`/`withWebhook`/`withKiosk` (non-session). `getOptionalSessionUser` is for genuinely-public
> reads only, **not** an escape hatch from `withAuth`.

### Dependency summary (post-2026-07-22)
```
✅ #568/#569 (#1)  ✅ #570 (#2)  ✅ #571/#572/#575 (Step1)  ✅ #573 (Step2)  ✅ #574/#576/#577/#578 (Step3) ─► [merged baseline]
                                                                                                              │
  ✅ Step7 (drift-guard — `routeAuthDrift.test.ts`)      NOW ►  Step5 (backfill) ─► Step6 (derive hook + collapse)  ── the live frontier
```
Step 4 is near-empty (`notifications`). §7.7 (library extraction) appears nowhere on this path.

### Definition of done
- ✅ Admission unified: four typed front doors (`withAuth`/`withCron`/`withWebhook`/`withKiosk`);
  `authenticateRequest` internal-only; `getServerSession` down to 1 (dev-personas, allowlisted).
- ✅ PII reads strip fields on the merged routes (no enumerable-ID roster leak — closes risk #1 for the
  program family + payment-plans + shop/members + `programs/[id]`).
- ✅ Three CI validators GREEN and GATING (field-existence, model-coverage incl. `isScopable`
  auto-exempt, route-grant resolvability). `OPT_OUT_PENDING_ROUTE` drains as later routes expose its
  models.
- ✅ Drift-guard (Step 7) landed (`tests/security/routeAuthDrift.test.ts`);
  `SCOPE_BINDINGS_MIGRATION.md` deleted.
- ⬜ Later: collapse `withAuth` into degenerate `handler()`; zero `if (...) return 403` in bodies.
  Library extraction deferred to §7.7.

---

## 10. Security-gap vs cleanup triage (verdict)

**Headline:** the real leaks are closed (top-10, `programs/[id]` #575). The remaining ~36 reads / ~43
writes are uniformity / backstop. The one item that was genuinely *security* — the **drift-guard
(Step 7)**, preventive because the class it guards had already re-grown — is now **landed**
(`routeAuthDrift.test.ts`). `derive`-hook / Step 6 collapse = cleanup (admission is already correct).

### GAP-1 — denied-household lockout bypass *(low severity, real, fixed #579)*
Two `getServerSession` write paths gated on a signal that **survives denial** (per `authClaims.ts:33`,
denial strips role flags + toolStatuses but keeps `id`): `programs/[id]` PATCH (gates on
`leadMentorId === user.id`) and `shop/certifications` POST (re-queries certifier status from the DB). A
denied lead-mentor / certifier still acted. Fixed by the denied gate (#579), root fix being conversion to
`withAuth` (enforces the denied gate for free).

### GAP-2 — IDOR via hand-rolled row checks *(the structural class)*
`withAuth` does admission only; **49 of 63** sites pass no roles and re-implement "is this my row?"
inline. Each is an independent chance to forget the check → IDOR (the team already hit one, `fd192fc`).
The lever is declarative `authorize` (collapses 69 review surfaces into one CODEOWNERS-gated registry).

**Calibration — what is and isn't actually closed:**
- **The validators do NOT detect IDOR.** IDOR is *under-restriction*; the checks catch the opposite:
  `validateBindings` (models bound), `validateRouteGrants` (grants *resolve* → **over**-restriction).
  **No check judges whether a grant is too *permissive*** — a route handing `everyones:pii` to
  `authenticated` passes every validator. Appropriateness is caught by **CODEOWNERS review of `registry.ts`
  + negative tests**, not a green gate. The gate ensures *consistency*, not *tightness*.
- **The runtime anti-IDOR is per-row scope stripping** (`scopesHeld`+`stripBag`) — covers only **reads of
  sensitive-tier fields**. It cannot touch: (1) IDOR reads of **public-tier** data (the §5.1a association
  class); (2) **any write** (stripping is a response filter; the mutation already happened). A write is
  gated *only* by `authorize`, and only if `authorize` is row-aware.
- **Most of the "69" are NOT live IDOR.** Sensitive-field reads → stripping covers; role-gated reads →
  admission covers; writes whose `[id]` *is* the owned entity → declarative `authorize` closes them.

**The residual IDOR-write surface (~6 endpoints).** Mutations whose `[id]` names a **child** entity and
whose ownership lives on a **parent relation** the param-keyed `authorize` grammar can't express, so the
gate stays inline and forgettable:

| endpoint | `[id]` → owner hop | current gate | note |
|---|---|---|---|
| `events/[id]` PATCH | event → program lead | inline `leadMentorId === user.id` | was GAP-1-adjacent |
| `events/[id]/attendance` POST | event → program lead | inline | **has** IDOR tests (`eventAttendanceAPI`) |
| `events/[id]/rsvp` PATCH | event → program participant | inline 403 | **has** IDOR tests (`eventRSVPAPI`) |
| `household/emergency-contacts/[contactId]` PATCH/DELETE | contact → household lead | inline + query scoped to `householdId` | better-defended |
| `trusted-adults/[id]/renew` POST | trustedAdult → household/subject | service-layer check | **has** `fd192fc` IDOR test |
| `trusted-adults/[id]/withdraw` POST | trustedAdult → household/subject | service-layer check | **has** `fd192fc` IDOR test |

These stay inline even after full migration — the param-keyed grammar can't express the hop. Two levers,
neither the validator gate:
1. **Lift the hop into `CallerContext`** so it becomes declarative — works when ownership is one clean
   predicate.
   > **But NOT for `events/[id]*` — verified, do not attempt the obvious fold.** Reusing the RSVP
   > capability's `eventIdsInScopePrograms` (lead ∪ core-vol) as an events `authorize` term does not fit:
   > (a) **wrong granularity** — `attendance` POST and the PATCH edit/cancel branch gate on `leadMentor`
   > **only**, so reusing lead∪core-vol *widens* access (silent privilege escalation); (b) **`rsvp` PATCH
   > gates on *enrollment*** (`ProgramParticipant`), a relation the RSVP set doesn't compute; (c)
   > **`events/[id]` PATCH is multi-conditional** (lead-only for edit/cancel, lead∪core-vol for
   > attendance-confirm, same route), so one `authorize` term can't replace it. A correct lift needs
   > bespoke per-route sets AND still leaves inline branching → low ROI. **`eventIdsInScopePrograms` stays
   > RSVP-only; the events/[id] routes keep their inline gates as the accepted relation-hop exception.**
2. **Negative tests (the `fd192fc` pattern) as the backstop** — the *primary* lever for the events
   residue. `trusted-adults` has them; the once-under-tested three (`events/[id]/attendance`,
   `events/[id]/rsvp`, `emergency-contacts/[contactId]`) now have them too (chip `task_f13cfe70` done:
   `eventAttendanceAPI` / `eventRSVPAPI` / `authzOwnershipBoundary` integration tests, incl.
   assert-no-mutation-after-403).

**Verdict on GAP-2:** "closed" = *declared + CODEOWNERS-reviewed + sensitive-reads-stripped*, **not**
mechanically IDOR-proof. The open piece is the relation-hop **write** residue above, which needs
`CallerContext` extensions + targeted tests.

### Drift-guard (Step 7) — preventive security, not hygiene
Proof it's security: the class already re-grew (2 → 6 `getServerSession` usages; GAP-1 a re-grown risk-#2
instance). The guard stops the *class*. Subtlety: not every inline `403` is drift — relation-hop gates
(the §10 table) are an accepted, must-be-commented exception; distinguish them from un-migrated drift.

---

## 11. Edge/association sensitivity — verdict: KEEP workarounds, DO NOT build the primitive

**The pattern is real and distinct from field-tier sensitivity.** Confirmed against `classifications.ts`:
`ProgramParticipant` (programId/participantId/status) and `RSVP` (eventId/participantId/status) have
**zero** sensitive-tier fields — the leak is 100% *edge existence*. `fieldVisible('public', …)` ignores
scopes (`core.ts:240`), so per-field stripping is *structurally incapable* of protecting these. Extra
kicker: `stripValue` keeps rows and `.map`s arrays (`stripper.ts:46`), so even if tiered, the **array
length (roster size) leaks**.

**Which join models are in this class** (boundary: "are the *identifying* fields all `public`?"):

| model | identifying fields | edge fully public? | why |
|---|---|---|---|
| `ProgramParticipant`, `ProgramVolunteer` | `programId`, `participantId` (`public`) | **yes** | enrollment = two public FKs; only `isPaymentPlanRequested`/`isCore` tiered |
| `RSVP` | `eventId`, `participantId`, `status` (`public`) | **yes** | RSVP fact public; only `reminderSentAt:internal` |
| `Visit` | `participantId`, `associatedEventId` (`public`) | **yes** | presence = public FKs; only `arrivedAt`/`departedAt` `personal` |
| `TrustedAdult` / `TrustedAdultReview` | `householdId`, `counterpartyParticipantId` (`public`) | **no** | identity (`counterpartyName:personal`, `familyContext:pii`) is field-tiered — stripping handles it |
| `FeePayment` | `feeId`, `participantId` (`public`) | partial | edge keys public, but `paidAt`/invoice fields `personal` |

So the primitive would apply to the **top four only**; `TrustedAdult`/`FeePayment` are protected by
ordinary field tiers. The concept can't be "flag every join model."

**Read-side instances the primitive could target — only 3, all closed:** `programs/[id]` GET (inline
query-shape, leaked pre-#575), `events/[id]` GET (inline admission `forbidden()`), `attendance` GET
(hand-shaped self+household). (`facility/visits` = admin-role admission, not edge-specific;
`events/[id]/rsvp` PATCH = a write, GAP-2.)

**Verdict: keep the per-route workarounds.** A row-drop-by-scope primitive fails the cost test:
1. **It doesn't collapse the 3.** Each route's "who sees the edge" boundary is bespoke and *absent from
   the scope vocabulary*: `programs/[id]` = enrolled-household-member, `attendance` = same-household
   visitors, `events/[id]` = whole-route staff-only. Row-drop presupposes scopes that **don't exist** —
   you'd build new CODEOWNERS-gated scopes first. And for `events/[id]` row-drop turns a `403` into an
   empty `200` — strictly worse.
2. **`_count` breaks it.** `programs/[id]` deliberately keeps `_count.participants` (spots-remaining)
   **public** while hiding the rows. One row-drop flag can't say "rows private, count public."
3. **Reads only** — zero help for the §10 write residue.
4. **N=3, all closed, zero open leaks.** New classification concept + stripper change + new scopes +
   re-audit every association model, to refactor 3 closed cases = textbook over-engineering.

**The cheap, preventive substitute:** the real residual risk is a *new* roster route forgetting to gate
an `include` — exactly the pre-#575 failure. A ~20–30 line **edge-include drift-guard**: any route that
`include`s `{ ProgramParticipant, ProgramVolunteer, RSVP, Visit }` must be admission-gated, query-shaped,
or admin-role-gated, else CI fails. No runtime mechanism, catches the class cheaply. **Folded in as
rule 3 of the Step-7 static route scan** (`routeAuthDrift.test.ts`; chip `task_64466db5` done).

---

## Appendix — exact mechanism inventory (main, post-correction)

- **handler() (7):** `directory/board`, `membership-ops/applications`, `membership/reviews`*, `profile`*,
  `safety/trusted-adults`, `trusted-adults/mine`, `trusted-adults/operational` (*=mixed with withAuth).
  Registry: `src/security/registry.ts`. *(14 handler routes as of 2026-07-22.)*
- **getServerSession (20):** `attendance/manual`, `attendance`, `auth/dev-personas`,
  `events/[id]/attendance`, `events/[id]`, `events/[id]/rsvp`, `events/mine`, `events`,
  `finance-ops/payment-plans`, `programs/[id]/eligible-participants`, `programs/[id]/participants`,
  `programs/[id]/publish`, `programs/[id]/request-payment-plan`, `programs/[id]`,
  `programs/[id]/settings`, `programs/[id]/volunteers`, `programs/mine`, `programs`, `shop/members`,
  `shop/tools/[id]`. **→ chaum converts all 20** (1 remains as of 2026-07-22: `auth/dev-personas`,
  drift-guard-allowlisted).
- **cron (6):** all `cron/*`, guard `requireCronSecret` (`src/lib/cronAuth.ts`). **→ spence's withCron.**
- **webhook (2):** `webhooks/shopify`, `webhooks/zoho`. **→ spence's withWebhook.**
- **authenticateRequest direct (1):** `scan` (kiosk + body signature).
- **unguarded/public (4):** `auth/[...nextauth]` (NextAuth mount), `health`,
  `system-status/kiosk-version`, `programs/[id]/public-register`.
- **withAuth (63 files):** the remainder — of which **49 call sites pass no `roles`** (admission-only;
  `src/lib/auth.ts:69`).
