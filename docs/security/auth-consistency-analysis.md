# Auth consistency analysis — why `withAuth()` is only a "half rule"

**Date:** 2026-06-29 · **Last updated:** 2026-06-30 (post-merge of #568–#573)
**Scope:** `checkin-app/src/app/api/**/route.ts` (101 route files) and the auth/authorization
layer (`src/lib/auth.ts`, `src/lib/auth-options.ts`, `src/lib/authClaims.ts`, `src/security/*`).
**Status:** this document is the **single source of truth** for the auth/authorization
consolidation. It supersedes and retires `checkin-app/src/security/SCOPE_BINDINGS_MIGRATION.md`
(branch `claude/stoic-cohen-803161`) — that proposal is imported in full as §7 below; once this
doc lands, delete the standalone file so there is one plan, not two.

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
> | (merged) | `RouteSpec.returns?` field | §8 seam-validator input |
> | #574 | drop dead Fee/RSVP field refs | Step 3 Blocker 1 ✅ |
> | #575 | gate program roster from anonymous callers | §5.1a (P0 leak) ✅ |
> | #577 | drop bare `id` from heuristic + bind `AuditLog` | Step 3 Blocker 2 ✅ |
> | #576 | RSVP program-lead scope via `eventId` | RSVP capability ✅ |
> | #578 | wire scope validators as a green CI gate | Step 3 Blocker 3 ✅ — **gate LIVE** |
> | #579 | denied gate on program-edit + certify writes | GAP-1 ✅ |
> | #580 | remove `getServerSession` from API routes | Step 7 phase 1 ✅ |
>
> **STATE (post-rebase 2026-06-30): the real security work is essentially done.** Leaks closed
> (top-10, `programs/[id]`); validator gate **LIVE** (#578 — per-field stripping + grant resolvability
> over the registry, `policy.contract.integration.test.ts`); GAP-1 closed (#579); `getServerSession`
> gone from routes except one sanctioned, documented exception (`auth/dev-personas`); optional-session
> reads use `getOptionalSessionUser`.
>
> **The ONE remaining *security* item: the drift-guard CI check (Step 7 phase 2)** — a static scan that
> fails any route importing `getServerSession` (outside the allowlist) or calling `prisma` without a
> sanctioned wrapper. #580 removed the instances; nothing yet stops them returning, and the class
> already re-grew once (2→6). (Prereq: remove the 2 dead `getServerSession` imports in `shop/*`.) Plus
> IDOR negative tests for the relation-hop write residue (in flight, §10). Everything else — Step 5
> backfill, Step 6 collapse, derive hook, §11 edge-sensitivity — is cleanup/design, not security.

**Refs analyzed (now merged):**

| label | ref → PR | one-line |
|---|---|---|
| baseline | `87cc322` | the pre-campaign main this analysis started from |
| chaum | `claude/beautiful-chaum-e9a988` → **#569** | collapse session-web routes onto `withAuth` (P0-B2) |
| spence | `claude/wizardly-spence-ef9430` → **#568** | explicit `withCron`/`withWebhook` |
| stoic | `claude/stoic-cohen-803161` → **#573** | declarative validated scope bindings (was doc-only; implemented S0–S2) |
| funny-hugle | `claude/funny-hugle-f78899` → **#571** | program reads → `handler()` |
| affectionate-neumann | → **#573** | the S0–S2 port that surfaced the ROW_SCOPE_KEY / Fee-RSVP findings |

> Note on spence: it is branched off an older main and is missing ~12 commits (the `is`-prefix
> rename #562, Person=Participant rename #564, and the P0-B3 `authenticateRequest`→`withAuth`
> migration #565). Its raw `main..spence` diff (245 files, −2742 lines) is almost entirely rename
> noise. The real contribution is its single commit, isolated here via `merge-base..spence`
> (10 files: 6 cron + 2 webhook + 2 new wrapper libs).

> The prior audit referenced in the task (`docs/codebase-audit-2026-06-29.md`) is **not committed
> to any of the three refs**. The branch names and commit messages (P0-B2, P0-B3) confirm a
> coordinated "P0-B" campaign against auth sprawl; this report reconstructs its shape from the code.

---

## TL;DR

`withAuth()` is not a half rule because it is half-adopted. It is a half rule because it only
expresses **half of authorization**: it does **admission** (is this a logged-in, non-denied
session? optionally: does the caller hold one of these *global* role flags?) and nothing else.
Every endpoint whose authorization depends on the **row** — *this* household, *this* program,
*this* event, the caller's *own* record — cannot say so through `withAuth`, so it admits with an
empty `withAuth({})` and then re-implements the real check by hand in the body.

**49 of 63 `withAuth` call sites pass no roles at all** (`src/lib/auth.ts:69`). They are pure
"is-logged-in" gates with the actual authorization hand-rolled inline. The exceptions to `withAuth`
(`getServerSession`, `authenticateRequest`, cron, webhook) are *mostly the same pattern wearing
older clothes* — and the migration to fix them is already in flight across these three refs.

The single rule the codebase is reaching for already exists: it is **`handler()`**
(`src/security/handler.ts`), the registry-driven runtime that does admission **and** row-scoped
field stripping. `withAuth` is the stopgap, not the target. Only 7 routes use `handler()` today.

---

## 1. ROOT CAUSE — why routes escape `withAuth`

Corrected per-file mechanism census on `main` (101 route files; labels are multi-valued where a
file mixes mechanisms across HTTP methods):

| mechanism | files | bucket |
|---|---:|---|
| `withAuth()` | 63 | the rule |
| `getServerSession()` hand-rolled | 20 | **(c) drift** |
| `handler()` (5 pure + 2 mixed w/ withAuth) | 7 | **(b) principled** |
| cron `requireCronSecret` | 6 | **(a) session-less** |
| webhook HMAC/secret | 2 | **(a) session-less** |
| `authenticateRequest()` direct (`scan`) | 1 | **(b) principled** |
| genuinely unguarded / NextAuth mount | 4 | **(a) session-less / public** |

> Methodology caveat for future re-runs: route files use double-quoted imports and
> `withAuth<{ params: Promise<{ id: string }> }>(` generics with **nested `>`**. A regex like
> `withAuth(<[^>]*>)?\(` silently drops those (membership-ops, system-status/links) into a false
> "unguarded" bucket, and a single-quoted `from '@/security` grep misses every `handler()` route.
> Both bugs were hit and corrected during this analysis. The numbers above are post-correction.

### (a) Legitimately session-less or public — **12 files, principled**

These have no session by nature; `withAuth` would be wrong, not missing.

- `cron/membership-renewals`, `cron/nightly`, `cron/pending-participants`, `cron/post-event`,
  `cron/reminders`, `cron/trusted-adult-expiry` — all six **do** guard, via
  `requireCronSecret(req)` (`src/lib/cronAuth.ts`), a `Bearer $CRON_SECRET` timing-safe compare.
- `webhooks/shopify`, `webhooks/zoho` — signature/secret-authenticated; verify HMAC over the raw
  body. No cookie, no session.
- `auth/[...nextauth]/route.ts` — the NextAuth mount itself (`NextAuth(authOptions)`).
- `health/route.ts` — liveness probe.
- `system-status/kiosk-version/route.ts` — returns the git SHA so kiosks know when to reload.
  Unauthenticated by design (minor: it `execSync("git rev-parse HEAD")` and leaks the commit SHA;
  info-disclosure only, no PII).
- `programs/[id]/public-register/route.ts` — the public sign-up form. Unauthenticated **by design**
  (no account exists yet); defended with `rateLimit` + `rateLimitEmail` instead of a session.

### (b) Needs something `withAuth` cannot express — **8 files, principled**

- **`handler()` routes (7):** `directory/board`, `membership-ops/applications`, `membership/reviews`,
  `profile`, `safety/trusted-adults`, `trusted-adults/mine`, `trusted-adults/operational`
  (`src/security/registry.ts:14-122`). Every one of these returns **PII across households** with
  **role- and row-dependent field visibility** — e.g. a background-check reviewer sees applicant
  parents' names+emails (`everyones:pii`) but not internal notes (`registry.ts:71-78`); a keyholder
  sees a trusted adult's contact (`personal`) but not the family's board-facing context (`pii`)
  (`registry.ts:109-122`). `withAuth` has no field-stripping, so these *must* use `handler()`. Note
  `profile` and `membership/reviews` are **mixed files**: the read uses `handler()`, a sibling
  mutation uses `withAuth` (`src/app/api/profile/route.ts:7`).
- **`scan/route.ts` (1):** the kiosk check-in/out endpoint. Calls
  `authenticateRequest(req, rawBody)` directly (`scan/route.ts:20`) because it is **multi-actor**
  (kiosk signature *or* session) **and** the kiosk signature is an HMAC over the request **body**.
  `withAuth` calls `authenticateRequest(req)` with **no body** (`src/lib/auth.ts:80`), so it
  structurally cannot authenticate a signed-kiosk request. This is a real `withAuth` gap, not drift.

### (c) Pure drift / age — **20 files, accidental**

The 20 `getServerSession()` routes: all of `attendance/*`, `events/*`, `programs/*` (the
session-web CRUD surface), plus `finance-ops/payment-plans`, `shop/members`, `shop/tools/[id]`,
`auth/dev-personas`. These hand-roll `getServerSession(authOptions)` → `if (!session) 401` and then
do per-row authz inline. There is **no capability here `withAuth` lacks** — they predate the rule.
This is exactly the bucket **chaum** converts (§3). It is the clearest "accidental" category: the
fix is mechanical and changes no behavior.

**Verdict:** the exceptions are **mostly principled at the edges and accidental in the middle**.
The session-less (a) and field-stripping/kiosk (b) buckets are real and will always exist in *some*
form. The 20-file (c) bucket is pure age and is already being deleted.

---

## 2. WHAT `withAuth` CANNOT DO — and what the inline code reaches for

`withAuth` (`src/lib/auth.ts:69-100`) expresses exactly two things:

1. **Admission:** reject `unauthenticated`/denied-household (401), reject kiosk unless `allowKiosk`
   (403). The denied-household lockout (`src/lib/auth.ts:50`, mirrored in
   `assignParticipantClaims` `src/lib/authClaims.ts:28`) is its one genuinely valuable, hard-to-
   reproduce feature.
2. **A flat global-role OR-list:** `roles: ['isSysadmin', 'isBoardMember']` — checked as
   `roles.some(r => user[r] === true)` (`src/lib/auth.ts:90-96`). These are **global JWT flags**.

That is the whole vocabulary. It has **no** notion of:

- **per-field sensitivity** (PII vs internal vs personal stripping) — `handler()` has it
  (`stripBag`, `src/security/handler.ts:113`; `fieldVisible`, `src/security/core.ts:218`);
- **per-row scope** — "their own", "their household", "a participant in a program they lead/
  core-vol", "a current visitor in the building". `handler()` models these as `Scope`
  (`src/security/core.ts:43-53`) and resolves them per row against a prefetched `CallerContext`
  (`src/security/access-resolvers.ts:20-60`);
- **multi-actor entry** with body-bound signature auth (the `scan` case).

The smoking gun: **49/63** `withAuth` sites pass no roles (`src/lib/auth.ts:69`). Read a few and the
same shape recurs — admit anyone logged in, then hand-derive the real rule:

```ts
// trusted-adults/[id]/withdraw/route.ts:19
export const POST = withAuth({}, async (req, auth) => {
    if (auth.type !== "session") return ...401;       // dead at runtime; only narrows TS
    ...
    await withdrawTrustedAdult(id, auth.user.id);     // the REAL authz lives in the service
});
```

```ts
// events/[id]/route.ts (per chaum's converted form) — the authz is inline, not in withAuth:
const isSysAdminOrBoard = auth.user.isSysadmin || auth.user.isBoardMember;
const isLeadMentor   = event.program?.leadMentorId === userId;
const isCoreVolunteer = event.program?.volunteers?.some(v => v.participantId === userId && v.isCore);
if (!isSysAdminOrBoard && !isLeadMentor && !isCoreVolunteer) return ...403;
```

That inline `isLeadMentor`/`isCoreVolunteer` computation is **the exact thing
`buildCallerContext` already centralizes** for `handler()` routes — `programsLed`,
`programsCoreVolIn`, `householdIdsInScopePrograms`
(`src/security/access-resolvers.ts:25-31`). So the 49 admission-only routes are not doing something
`handler()` can't; they are **re-deriving, by hand and per route, the context `handler()` computes
once.**

> **Answering the direct question — why is `withAuth` used empty with enforcement done later?**
> Because the endpoint's authorization is *resource-scoped*, and `withAuth`'s only declarative knob
> is *global role flags*. The moment the rule is "the owner, or a lead of the program this row
> belongs to, or an admin," there is no way to say it in `withAuth`'s options object, so the author
> writes `withAuth({})` to get the session + denied-gate and then writes the real check in the body.
> The empty call is not laziness — it is the **type signature admitting it has nothing to offer**
> for the 78% of endpoints that are resource-scoped rather than role-scoped. The recurring inner
> `if (auth.type !== 'session')` is also not a second security check; with `allowKiosk` unset,
> `withAuth` already guarantees a session — that line exists only to narrow the `AuthResult` union
> so TypeScript lets you read `auth.user`.

**So: `withAuth` is under-powered, and `handler()` is the real intended rule.** `withAuth` is a
session-admission shim; `handler()` is the policy engine. The codebase's problem is that it adopted
the shim widely and the engine narrowly.

---

## 3. BRANCH COMPARISON — three takes, and they are **complementary, not competing**

The framing in the task ("competing or in-progress takes on the same problem") turns out to be only
half right: the two branches attack **different buckets** of §1 and barely overlap. Together with
what `main` already merged, they form one migration.

### `main` (already merged): bucket (c)-adjacent — `authenticateRequest` → `withAuth` (P0-B3, #565)
The most recent main commit (`87cc322`) converted the admin-web routes off direct
`authenticateRequest` onto `withAuth`. This is why the `authenticateRequest`-direct bucket is down
to a single principled route (`scan`) on main. The campaign is already one step in.

### chaum — bucket (c): `getServerSession` → `withAuth` (P0-B2)
- Converts **all 20** `getServerSession` routes to `withAuth`; **zero** `getServerSession` calls
  remain under `app/api/**/route.ts` on this branch (verified by grep).
- Net −105 lines. Every conversion is `getServerSession(authOptions)` + `if (!session) 401`
  → `withAuth({}, ...)` + `if (auth.type !== 'session')`. The per-row authz **is copied verbatim**
  into the body (see the `events/[id]` diff above — `isLeadMentor`/`isCoreVolunteer` unchanged).
- **Effect on the half-rule:** it adds **20 more empty `withAuth({})`** sites. The admission-only
  pool grows 49 → 69. chaum **centralizes admission and entrenches scattered authorization.** It is
  a correct, low-risk consolidation that makes the inconsistency *uniform* — which is a real
  improvement (one admission path, one denied-gate, no hand-rolled session reads) but is **not** a
  redesign. It makes the half-rule tidier, not whole.

### spence — bucket (a): make the session-less tail explicit (`withCron` / `withWebhook`)
- Adds two HOFs **shaped exactly like `withAuth`**: `withCron` (`src/lib/cronAuth.ts`) and
  `withWebhook` (`src/lib/webhookAuth.ts`). Each is `guard → handler → top-level catch`.
- `withCron` wraps the existing `requireCronSecret` gate plus a 500-catch so a throwing cron can't
  escape as an unhandled rejection. `withWebhook` standardizes rate-limit → raw-body verify →
  JSON-parse → integration-error-logging for the two provider webhooks.
- The cron routes on main **already** guard (all six call `requireCronSecret`), so spence is not
  closing a hole — it converts a repeated inline `const denied = requireCronSecret(req); if (denied)
  return denied;` into a wrapper a new route **cannot forget**. Same defensive value `withAuth`
  provides for sessions, extended to the other two actor classes.
- spence's philosophy is the important divergence: it says the session-less routes are a
  **legitimate, permanent category** and the right move is to give that category its own
  **first-class, named wrapper** — not to fold it into `withAuth`. This is the correct instinct
  (a cron is not a degenerate session) and it generalizes: it implies a **family** of sibling
  wrappers (`withAuth`, `withCron`, `withWebhook`, and — by the same logic — `withKiosk` for `scan`).

### Most coherent direction
- chaum is the most **immediately mergeable** and should land — it deletes the worst bucket (c).
- spence has the most **coherent theory** — name every actor class, one wrapper each, none can
  forget its guard.
- **Neither touches `handler()`.** The deepest problem (authorization scattered inline across 69
  routes) is addressed by neither branch. The two together get you to "one admission rule per actor
  class" — a real milestone — but **not** to "one authorization rule." For that you need the
  `handler()` direction below.

---

## 4. RECOMMENDATION — one rule that actually holds

### Target architecture: `handler()` is the rule; the `with*` wrappers are its actor-typed front doors

The end state is **one policy surface** (`src/security/registry.ts`) and a small family of entry
wrappers that all funnel into the same admission + row-scope + field-strip pipeline. Concretely:

1. **`handler()` becomes the default for every authenticated, data-returning route.** It already
   does what 69 routes hand-roll: admission (`resolveAccess`, `handler.ts:76`), role-view selection
   (`orderedView`, `handler.ts:88`), per-row scope resolution (`access-resolvers.ts`), and field
   stripping (`stripBag`, `handler.ts:113`). The `Authorize` admission grammar
   (`src/security/core.ts:116-125`) already includes `self`, `household-member`, `household-lead`,
   `program-lead-mentor`, `program-core-volunteer` — i.e. **the exact inline checks** the empty-
   `withAuth` routes re-derive. Most of the 69 routes' inline `if (!isLeadMentor && ...) 403` blocks
   collapse to a one-line registry `authorize` entry plus an `orderedView`.

2. **Merge `withAuth` into `handler()` as a degenerate policy, do not keep it as a parallel layer.**
   A route that needs admission but no field stripping is just a registry entry with a permissive
   `orderedView` (everything `public`/`member`) — the stripper becomes a no-op. There is no reason
   for two admission code paths. Keep a thin `withAuth`-named export for migration ergonomics if
   desired, but it should call `handler()` under the hood, not `authenticateRequest` directly. This
   removes the "admit then hand-roll" pattern at the root: there is nowhere to hand-roll, because the
   row scope is declared, not coded.

3. **Adopt spence's wrapper family for the non-session actors — as siblings that share the runtime.**
   `withCron`, `withWebhook`, and a new `withKiosk` (for `scan`, carrying the raw body to the
   signature verifier — the one thing `withAuth` can't do, `auth.ts:80`) become the typed front
   doors for the (a) and multi-actor (b) buckets. They do not need the stripper, but they **should**
   share the same `apiError`/catch envelope so "every response leaves through a wrapper" becomes
   literally true. spence already builds two of the three.

4. **`authenticateRequest` stops being a public entry point.** It is fine as the **internal**
   primitive that `handler()` and the `with*` wrappers call. No route should import it directly once
   `scan` has a `withKiosk` (the last direct caller).

Resulting rule, stated in one sentence: **every route is `export const METHOD = withX(policy, fn)`
where `withX` ∈ {`handler`/`withAuth`, `withCron`, `withWebhook`, `withKiosk`}, the `policy` is
declared in the registry, and no route body contains an `if (...) return 403`.** A lint/registry
drift-guard test (the `defineRoute` registry already throws on duplicates/unknown roles,
`core.ts:162`) enforces it: a route file that calls `prisma` without a registered policy fails CI.

> **Principled exception — relation-hop admission stays inline (learned from `events/[id]`).** The
> `authorize` grammar keys on the route's own `[id]` param. When admission depends on a relation the
> param does *not* directly name — e.g. `events/[id]`'s `[id]` is an *event* id but the gate is "lead
> of the event's *program*" — `resolveAccess`'s program-scoped cases (which key on a *program* id)
> can't express it, and teaching them to would touch the CODEOWNERS-gated `access-resolvers.ts`. The
> pragmatic, accepted resolution: the handler fn (which has already fetched the row) does that one
> relation-hop check and throws `forbidden()` inline. So the rule is really **"no *ad-hoc* authz in
> bodies"**: a `403` that exists *because the registry grammar cannot yet express a relation hop* is
> allowed, must be commented as such, and is a candidate to lift into `authorize` later (by adding the
> relation to `CallerContext`). Distinguish it from a `403` that is just un-migrated drift.

### Migration path (overview — the executable, ordered version is §9)

| # | step | status |
|---|---|---|
| 1 | Admission rule per actor class — `getServerSession`→`withAuth` (chaum) **and** `withCron`/`withWebhook` (spence) | ✅ **merged #569, #568** |
| 2 | `withKiosk` + convert `scan`; remove the last direct `authenticateRequest` route import | ✅ **merged #570** |
| 3 | **Security first:** strip PII on the highest-leak reads, already-bound ones immediately | ✅ **largely merged #571, #572** (3 routes left, §9 Step 1) |
| S | Scope-resolver switch → declarative `SCOPE_BINDINGS` — *only* to enable the validators (minimal; no library) | ✅ **merged #573 (S0–S2)** |
| 3v | The **three CI validators** incl. the route-grant ↔ binding-scope seam check | ⚠️ **authored, NOT gated — §9 Step 3 is the live frontier** |
| 4 | Collapse `withAuth` into a degenerate `handler()`; drift-guard | **planned — §9 Steps 6–7** |
| — | Extract a shared security *library/package* | **OUT OF SCOPE — follow-on §7.7** |

Steps 1 and 2 reach "one admission rule per actor class." The rest reaches "one *authorization*
rule." **§9 sequences them security-first** — stop the leaks, then lock with validators, then
cleanup; library extraction is deferred and never on the critical path.

### What to **reconsider**, not refactor

- **`scan` sharing kiosk + session actors on one endpoint** is the only genuinely-multi-actor route
  and it is principled — but its existence is *why* `authenticateRequest` is public. Giving it
  `withKiosk` is the refactor; do not generalize "multi-actor endpoints" as a pattern — it should
  stay a deliberate, single exception.
- **`system-status/kiosk-version` running `execSync("git rev-parse HEAD")`** on an unauthenticated
  route is a smell. Reconsider whether the SHA needs to be public at all, or read it from
  `VERCEL_GIT_COMMIT_SHA`/build-time env only (it already prefers that — drop the shell fallback).
- **Mixed-mechanism files** (`profile`, `membership/reviews`: `handler()` for reads, `withAuth` for
  writes) should not exist post-migration — once `withAuth` is a degenerate `handler()`, both
  methods register policies and the file uses one mechanism.
- **The 20-file `getServerSession` bucket should never have drifted.** The lasting fix is not the
  one-time conversion but the **drift-guard test** that fails CI on any new `getServerSession` /
  `authenticateRequest` import outside the wrapper libs. Without it, bucket (c) regrows.

---

## 5. RISKS of the current half-rule state

Ranked by likelihood of a *real* authz bug, given that authorization is hand-written in 69 route
bodies with no central enforcement:

1. **Missing field-stripping on PII (highest).** Only 7 routes strip fields; every other route that
   returns participant/household data emits **whatever the Prisma query selected**. A `withAuth`
   route that over-`include`s a relation leaks PII with no backstop — there is no `stripBag` in the
   `withAuth` path at all (`src/lib/auth.ts` has zero field logic). The `events/[id]` GET comment
   admits this directly: *"Without this gate any authenticated user could harvest roster PII by
   enumerating sequential event IDs"* — the gate is one hand-written `if`, and the next over-broad
   `include` on a route whose author forgets the gate is an unbounded PII leak. **This is the most
   likely place a real breach originates**, and it is exactly what `handler()` exists to prevent.

   > **1a. Association/existence leaks — a class `handler()` stripping CANNOT fix (learned migrating
   > `events/[id]`).** Field stripping protects *sensitive-tier fields*. It does nothing when the leak
   > is the **existence of an association** whose identifiers are `public`-tier. A `ProgramParticipant`
   > / `RSVP` / `Visit` row simply *existing* reveals "person X is enrolled in / attending program Y,"
   > and `Participant.name` is **`public`** (`classifications.ts`) — so the stripper leaves it. No
   > token configuration removes a public field; the tier model tiers *fields*, not the *existence of
   > a row*. For these payloads the only protection is **admission-gating** (who may call) or
   > **role-shaping the query** (don't `include` the association for unauthorized callers) — not
   > stripping. Two live instances:
   > - **`events/[id]` GET (fixed):** now fail-closed, staff-only — the handler resolves event→program
   >   and does the lead/core-vol/admin check *inline* (throws 403), restoring the original gate.
   >   `handler()`+stripping remain as defense-in-depth on the staff tiers only. A stripper test pins
   >   the leak (`name` survives strip) as the regression anchor that explains *why* admission must gate.
   > - **`GET /api/programs/[id]` (OPEN — pre-existing):** `authorize: 'public'`
   >   (`registry.ts`), `include`s `participants`/`volunteers`, and the `anyone → ['public']` view
   >   keeps `name` → **any unauthenticated caller can enumerate program ids and harvest the full
   >   enrollment roster.** Stripping can't help (names are public). Fix = role-shape the query: return
   >   program *metadata* to the public, but only `include` the participant/volunteer associations for
   >   staff/enrolled callers. Added to the §9 work list. This is the same leak class as `events/[id]`,
   >   still open and reachable **without a session at all** — arguably the single highest-severity
   >   item in this document.

2. **Inconsistent denied-household enforcement (high).** The denied-household lockout is enforced in
   two places: `authenticateRequest` (`auth.ts:50`) and the JWT claims
   (`authClaims.ts:33-39`). Every `withAuth` route inherits it. But a route on **bare
   `getServerSession`** (the 20 pre-chaum routes) reads `session.user` directly and **does not pass
   through the `denied` short-circuit** — it sees a session object and proceeds. A denied household
   doing a **write** through one of the `attendance/*` or `events/*` `getServerSession` routes is
   the concrete hazard. **chaum closes this** by routing all 20 through `withAuth` — which is a
   security fix, not just a cleanup, and is the strongest argument for landing it promptly.

3. **IDOR via hand-rolled row checks (high).** With 69 routes each implementing their own
   "is this my row?" test, the failure mode is a route that **admits** (`withAuth({})`) but **forgets
   the row check** — e.g. trusts a `[id]` param without verifying ownership. The trusted-adult
   withdraw/renew routes have explicit negative tests for exactly this (commit `fd192fc`,
   "assert no mutation after IDOR 403"), which tells you the team already found at least one. Each
   un-migrated route is an independent chance to reintroduce it; a declared `authorize: 'self'` /
   `'household-lead'` cannot be forgotten the way an inline `if` can.

4. **Kiosk-vs-session confusion (medium).** `scan` is the only route that branches on `auth.type`,
   and it does so by hand after a direct `authenticateRequest(req, rawBody)`. The local-dev kiosk
   fallback (`auth.ts:32-41`) treats a cookie-less request as a kiosk when no signing key is
   configured — correct on `CHECKIN_ENV=local`, explicitly disabled on the public dev box. This is
   well-commented and currently contained to one route, but if any *other* route ever copies the
   `allowKiosk` flag without understanding the body-signature requirement, it would admit kiosks it
   cannot actually authenticate (because `withAuth` passes no body). Containing kiosk auth to a
   single `withKiosk` wrapper removes this footgun.

5. **Cron/webhook guards are uniform today but unenforced (low).** All six cron routes guard and
   both webhooks verify — but nothing *makes* a new one do so. spence's wrappers convert this from
   convention to structure. Low risk today, rising with every new background job.

---

## 6. The two layers, and the seam between them

The registry work (§4, §9) and the scope-bindings refactor (§7) are **different layers of the same
pipeline**, and understanding the seam is what makes the combined plan safe.

| | Registry layer (§4/§9) | Scope-resolver layer (§7) |
|---|---|---|
| File | `registry.ts` route specs + route bodies | `access-resolvers.ts` → `SCOPE_BINDINGS` |
| Question | "which `scope:tier` grants does this **route** hand out?" (`orderedView`) | "given a **row**, which scopes does the caller hold?" (`scopesHeld`) |
| Operand in the stripper | the **tokens** argument | the **scopes** argument |

The stripper multiplies them: `fieldVisible(tier, tokens, scopesHeld)` (`core.ts:218`). A field
reaches the wire only if the route *granted* a `scope:tier` token **and** the caller *holds* that
scope on that row. Neither layer is sufficient alone, and they are authored in different files by
(potentially) different people.

**Three consequences drive the rest of this plan:**

1. **The scope refactor (§7) makes the registry backfill (§9) safer.** When §9 registers ~60 new
   routes, each newly routes a model through the stripper. If a model resolves to only `everyones`
   (because its binding was forgotten), a `their_program_participants:pii` grant silently resolves to
   nothing — the lead sees an empty roster, looks like a backend bug, no alarm (fail-safe). §7's
   coverage validator ("every sensitive model is bound, auto-exempt, or queued") is exactly the guard
   against that. So **do §7 before the bulk of §9.**

2. **Model coverage is a *moving* line — track it with one queue, not a permanent list.** A model
   admin-only today may become household/program-scoped when a route ships — e.g. `MembershipProcess`
   or `Corporation`. §7.5.1 handles this with **no permanent opt-out list**: structurally un-scopable
   models (no actor FK) are *auto-exempt* by `isScopable()`, "never leaves" content is tiered `secret`,
   and the only hand-maintained set is `OPT_OUT_PENDING_ROUTE` — a work queue each PII route drains by
   moving its model into a real binding in the same PR. Done = queue empty. *(`EmergencyContact` was
   already done — the live switch binds it via `their_households` + a `ROW_SCOPE_KEY` fail-closed
   guard — so it is **not** queued; its route is an already-bound Step-1 read, §9.)*

3. **Neither validator guards the seam — so this plan adds a third (§8).** §7's validator proves
   *every sensitive model is bound*. It does **not** prove *every `scope:tier` token a route grants
   is resolvable on the model that route returns*. That cross-check lives between `registry.ts`
   (grants) and `SCOPE_BINDINGS` (resolution), and §9 is precisely what populates it 60×. §8
   specifies the missing validator.

---

## 7. Scope-resolver refactor — declarative, validated `SCOPE_BINDINGS`

> **Imported from `SCOPE_BINDINGS_MIGRATION.md` (branch `claude/stoic-cohen-803161`), which this
> document retires — and re-prioritized.** The source framed this as a step toward a *shared,
> reusable security library* for a future multi-app monorepo. **That framing is demoted here: the
> priority is the security and validation value, not building a library.** The package extraction is
> an explicit *follow-on project* (§7.7), out of scope for this plan. Corrections folded in inline:
> the `Visit` field-name fix (§7.5), and removal of `OPT_OUT_PERMANENT` in favor of auto-exemption +
> a single pending queue (§7.5.1). Phases renumbered **S0–S3** to avoid colliding with Migration
> #1–#4.

**Why this is in the plan at all (it is security, not refactoring-for-its-own-sake):** the three
CI validators that catch real data-leak classes — field-typo, forgotten-model, and the §8 route-grant
seam — can only run against *declarative* binding data. Today `scopesHeld()` is an opaque `switch`,
so none of them are possible. Converting the switch to a data table is the **minimum** needed to make
the security checks exist. We do that and nothing more. We do **not** split it into a shared package,
generic engine homes, or an app-agnostic substrate — that is §7.7, later.

### 7.1 Problem

Per-row scope resolution lives in `scopesHeld()` (`access-resolvers.ts`) as a ~110-line
`switch (modelName)` that tangles two responsibilities:

- **Plumbing** — seed `everyones`, null-guard the row, the add-and-return loop.
- **Bindings** — "scope `their_households` is held on `Participant` when
  `row.householdId === ctx.householdId`." Schema-shape knowledge.

Two **security** failure modes fall out of the entanglement — both produce silent wrong access:

1. The bindings are **opaque code**. `row.householdId` is a property access on
   `Record<string, unknown>`, so a typo (`row.householdID`) compiles, returns `undefined`, silently
   never grants the scope, and ships. Over-restriction is fail-safe-ish but invisible — no test, type
   error, or build failure catches it. (The source proposal's own `Visit.departed` typo, §7.5, is a
   live example.)
2. A model added to the schema but **forgotten** in the switch silently gets only `everyones`. No
   coverage check exists — so a sensitive model can sit reachable only through admin views by
   accident, indistinguishable from by-design.

Neither can be caught while resolution is imperative code. **Making it declarative data is what lets
CI check it** — that is the whole reason it is in this security plan. (A separate, later goal — a
shared library for a future multi-app monorepo — also benefits, but it is **not** the driver here and
is deferred to §7.7.)

### 7.2 Goal / non-goals

**Goal (security).** Make scope resolution *checkable in CI*. Convert the imperative `switch` to a
declarative `SCOPE_BINDINGS` table interpreted by one local function, so three validators can run:
every `field:` in a binding **exists** on that model; every sensitive model is **bound or
auto-exempt** (§7.5.1); and (§8) every scope a route *grants* is *resolvable* on what it returns. Two
human-review correctness questions become mechanical build checks.

**Non-goals (this refactor).** No change to the tier vocabulary
(`public/pii/personal/internal/secret`). No change to the Role / Token / `orderedView` grammar
(`core.ts`) or the route specs in `registry.ts` — that layer is §9's job. No change to runtime
*behavior* — same fields reach the wire for every caller; phase **S1** enforces this with an
equivalence test before any old code is deleted. **No library extraction, no shared package, no
generic/per-app home split** — all of that is the §7.7 follow-on. Everything here lands inside
`checkin-app/src/security/`.

### 7.3 Target architecture

Three pieces, **one home** (`checkin-app/src/security/`) — kept deliberately local; the §7.7
follow-on can lift the generic parts into a package later, but that is not done now:

```
checkin-app/src/security/
─────────────────────────────────────
Match type + evalMatch interpreter        (scopes.ts)
makeScopesHeld(bindings) -> scopesHeld     "
validateBindings / validateRouteGrants     "   (the CI security checks)
SCOPE_BINDINGS + OPT_OUT_PENDING_ROUTE     (scopeBindings.ts — data)
CallerContext + buildCallerContext         (access-resolvers.ts — unchanged)
```

> `makeScopesHeld` is a factory only because it keeps the table and the engine in separate files for
> testability — **not** to support multiple apps. If a plain module-level table read is simpler at
> implementation time, prefer it; the library-shaped factory is not a requirement of this plan.

**Match vocabulary** — derived from and proven complete against all 14 cases in the current switch:

```ts
export type CtxScalar = 'selfId' | 'householdId';
export type CtxSet =
    | 'programsLed' | 'programsCoreVolIn'
    | 'participantIdsInScopePrograms' | 'householdIdsInScopePrograms' | 'activeVisitorIds';
export type CtxFlag = 'isKeyholder' | 'isKiosk';

export type Match =
    | { field: string; eqCtx: CtxScalar }                   // row[field] === ctx[scalar]
    | { field: string; inCtx: CtxSet | readonly CtxSet[] }  // ctx[set].has(row[field]); array = OR over sets
    | { flag: CtxFlag }                                     // ctx[flag] === true
    | { field: string; isNull: true }                       // row[field] == null
    | { all: readonly Match[] }                             // AND
    | { custom: ScopePredicate };                           // escape hatch — SKIPS validation, must be logged

export type ScopePredicate = (row: Record<string, unknown>, ctx: CallerContext) => boolean;
export type ScopeBindings = Record<string, Partial<Record<Scope, Match>>>;
```

`eqCtx` carries the original `!== undefined` guard inside the interpreter (`typeof === 'number'`), so
an anon caller (`selfId === undefined`) never spuriously matches a row whose field is also absent.
`inCtx`-array models the two `programsLed || programsCoreVolIn` disjunctions. `all` is the only
combinator needed (every compound case is an AND); adding `any` later is additive. `custom` is the
escape hatch — **none of checkin's 14 cases need it**; custom entries skip validation, so the engine
must `console.warn` them as audit-flagged.

**Interpreter + engine (shared):**

```ts
function evalMatch(m: Match, row: Record<string, unknown>, ctx: CallerContext): boolean {
    if ('flag' in m)   return ctx[m.flag] === true;
    if ('isNull' in m) return row[m.field] == null;
    if ('all' in m)    return m.all.every(s => evalMatch(s, row, ctx));
    if ('custom' in m) return m.custom(row, ctx);
    if ('eqCtx' in m) { const v = row[m.field]; return typeof v === 'number' && v === ctx[m.eqCtx]; }
    const v = row[m.field];                                  // inCtx
    if (typeof v !== 'number') return false;
    const sets = Array.isArray(m.inCtx) ? m.inCtx : [m.inCtx];
    return sets.some(s => ctx[s].has(v));
}

// ROW_SCOPE_KEY (verified live: { EmergencyContact: 'householdId' }) — a row-scoped model whose
// scope key is absent FAILS CLOSED: it returns {} (no scopes), NOT {everyones}. Dropping this — as
// the original stoic sketch did — regresses a real defense-in-depth guard and breaks both the
// equivalence test and stripper.test.ts:264. It MUST be carried through makeScopesHeld.
export function makeScopesHeld(bindings: ScopeBindings, rowScopeKeys: Record<string, string>) {
    return (modelName, row, ctx): Set<Scope> => {
        const rowMissing = !row || typeof row !== 'object';
        // No row, or a row-scoped model missing its key → fail closed for row-scoped models;
        // broad scope only for non-row-scoped ones.
        if (modelName in rowScopeKeys) {
            if (rowMissing || typeof (row as any)[rowScopeKeys[modelName]] !== 'number') return new Set();
        } else if (rowMissing) {
            return new Set(['everyones']);
        }
        const scopes = new Set<Scope>(['everyones']);
        const modelBindings = bindings[modelName];
        if (!modelBindings) return scopes;
        for (const [scope, match] of Object.entries(modelBindings)) {
            if (evalMatch(match as Match, row, ctx)) scopes.add(scope as Scope);
        }
        return scopes;
    };
}
```

`everyones`-always, the null-guard, the **ROW_SCOPE_KEY fail-closed guard**, and the loop now live in
exactly one place, tested once. The call signature `scopesHeld(modelName, row, ctx)` is **preserved**
— call sites in `stripper.ts` (`stripValue`) and the contract tests are unchanged.

> **Correction (from the live port, branch `claude/affectionate-neumann-495641`).** The stoic engine
> sketch omitted `ROW_SCOPE_KEY`. The live resolver fails closed for a row-scoped model whose key is
> absent (`access-resolvers.ts`: `return new Set<Scope>()`), seeded today by `{ EmergencyContact:
> 'householdId' }`. The S2 implementer carried it via a `rowScopeKeys` param (above). As more models
> get row-scope keys, add them here — the verbatim stoic port would have regressed this guard.

**Validator (runs in CI):**

```ts
// A model is *scopable* iff at least one of its fields could match a context accessor — i.e. it has
// a foreign key / id by which some non-admin actor could own a row. A model with sensitive fields
// but NO such field is structurally un-scopable: no their_* binding is even expressible, and its
// sensitive fields are reachable only via everyones:* (admin) grants. That is a derivable fact, not a
// human opt-out. (See §7.5.1 for why OPT_OUT_PERMANENT does not exist.)
// NB: bare `id` is deliberately EXCLUDED. `id` is a scope field only for Participant (id===selfId),
// and Participant is always in SCOPE_BINDINGS, so the coverage check never evaluates isScopable for
// it. Including `id` would make every log/settings table (all have an `id`) falsely "scopable" and
// defeat the auto-exemption — exactly what the live port found (BoardSettings/ErrorLog/… wrongly
// flagged). A model is scopable iff it has a foreign key to an *actor*, never just a primary key.
const SCOPABLE_FIELDS = new Set(['householdId', 'programId', 'participantId', 'userId', 'actorId', 'createdById']);
function isScopable(model: string, classifications: Record<string, Record<string, string>>): boolean {
    return Object.keys(classifications[model] ?? {}).some(f => SCOPABLE_FIELDS.has(f));
}

export function validateBindings(
    bindings: ScopeBindings,
    classifications: Record<string, Record<string, string>>,
    pendingRoute: ReadonlySet<string>,        // OPT_OUT_PENDING_ROUTE — sensitive, scopable, route not built yet
): string[] {
    const errors: string[] = [];
    // (a) field-existence — the typo catcher
    for (const [model, scopeMap] of Object.entries(bindings)) {
        if (!(model in classifications)) { errors.push(`binding for unknown model '${model}'`); continue; }
        for (const m of allMatches(scopeMap)) {
            if ('field' in m && !(m.field in classifications[model])) errors.push(`${model}.${m.field} — no such field`);
            if ('custom' in m) console.warn(`[security] ${model} has a custom (unvalidated) scope binding`);
        }
    }
    // (b) coverage — the forgotten-model catcher
    for (const [model, fields] of Object.entries(classifications)) {
        const hasSensitive = Object.values(fields).some(t => t !== 'public' && t !== 'secret');
        if (!hasSensitive) continue;
        if (model in bindings) continue;
        if (!isScopable(model, classifications)) {
            // Structurally un-scopable → admin-only by construction. Auto-exempt, but log it so the
            // exemption is visible in CI output and a reviewer can challenge a wrong tier.
            console.info(`[security] ${model}: sensitive but un-scopable (no actor FK) — admin-only by construction`);
            continue;
        }
        if (pendingRoute.has(model)) continue;   // scopable, sensitive, route-build deferred — tracked
        errors.push(`${model} is sensitive and scopable but has no binding and is not in OPT_OUT_PENDING_ROUTE — silent over-restriction`);
    }
    return errors;
}
```

`allMatches` walks a model's scope map and descends into `all` combinators. The **generator stays
unchanged** — the validator is a separate consumer of generated output, not a generator edit.

> `SCOPABLE_FIELDS` is the set of column names the context can match on; keep it in sync with
> `CtxScalar`/`CtxSet`'s underlying FKs (a tiny list, changes rarely). If "never leaves, even to
> admin" is the intent for some field, tier it `secret` — already exempt — not opt-out.

> **Note — the validator checks against the *classifications* map, which lists tier-bearing fields.**
> Verified: the structural columns the bindings match on (`id`, `householdId`, `programId`,
> `participantId`, `departedAt`) **are** present in `classifications` (mostly tier `public`;
> `Visit.departedAt` is `personal`). So field-existence validation works for them. If a future binding
> ever matches on a column that has *no* `@sensitivity` tier (and so is absent from `classifications`),
> the validator would wrongly flag it — at that point the fix is to ensure structural FK/id columns
> are always emitted into `classifications` (even at `public`), which the generator already does today.

### 7.4 Full binding port (all 14 cases)

Every model that has a `case` today, ported 1:1. (Verbatim from the source proposal, **with the
`Visit` correction applied** — see §7.5.)

```ts
export const SCOPE_BINDINGS = {
    Participant: {
        their_own:                  { field: 'id', eqCtx: 'selfId' },
        their_households:           { field: 'householdId', eqCtx: 'householdId' },
        their_program_participants: { field: 'id', inCtx: 'participantIdsInScopePrograms' },
        all_current_visitors:       { all: [{ flag: 'isKeyholder' }, { field: 'id', inCtx: 'activeVisitorIds' }] },
    },
    Household:       { their_households: { field: 'id', eqCtx: 'householdId' } },
    HouseholdLead:   { their_households: { field: 'householdId', eqCtx: 'householdId' }, their_own: { field: 'participantId', eqCtx: 'selfId' } },
    Membership:      { their_households: { field: 'householdId', eqCtx: 'householdId' } },
    Program:         { their_program_participants: { field: 'id', inCtx: ['programsLed', 'programsCoreVolIn'] } },
    ProgramParticipant: { their_program_participants: { field: 'programId', inCtx: ['programsLed', 'programsCoreVolIn'] }, their_own: { field: 'participantId', eqCtx: 'selfId' } },
    ProgramVolunteer:   { their_program_participants: { field: 'programId', inCtx: ['programsLed', 'programsCoreVolIn'] }, their_own: { field: 'participantId', eqCtx: 'selfId' } },
    // Fee has programId but NO participantId → their_program_participants only (the grouped switch read
    // both; participantId was inert on Fee rows, but porting it verbatim is a field-existence error).
    Fee:                { their_program_participants: { field: 'programId', inCtx: ['programsLed', 'programsCoreVolIn'] } },
    // RSVP has participantId but NO programId → their_own only (same grouped-case correction, inverse).
    RSVP:               { their_own: { field: 'participantId', eqCtx: 'selfId' } },
    Event:           { their_program_participants: { field: 'programId', inCtx: ['programsLed', 'programsCoreVolIn'] } },
    FeePayment:      { their_own: { field: 'participantId', eqCtx: 'selfId' }, their_program_participants: { field: 'participantId', inCtx: 'participantIdsInScopePrograms' } },
    Visit:           { their_own: { field: 'participantId', eqCtx: 'selfId' }, all_current_visitors: { all: [{ flag: 'isKeyholder' }, { field: 'departedAt', isNull: true }] } },
    // EmergencyContact IS already bound in the live switch (ROW_SCOPE_KEY: 'householdId', fail-closed).
    EmergencyContact: { their_households: { field: 'householdId', eqCtx: 'householdId' } },
    RawBadgeLog:     { their_own: { field: 'participantId', eqCtx: 'selfId' } },   // live model is RawBadgeLog, not RawBadgeEvent
    ToolStatus:      { their_own: { field: 'participantId', eqCtx: 'selfId' } },
    Account:         { their_own: { field: 'userId', eqCtx: 'selfId' } },
    Session:         { their_own: { field: 'userId', eqCtx: 'selfId' } },
    TrustedAdult:       { their_households: { field: 'householdId', eqCtx: 'householdId' }, their_program_households: { field: 'householdId', inCtx: 'householdIdsInScopePrograms' }, keyholders: { flag: 'isKeyholder' } },
    TrustedAdultReview: { their_households: { field: 'householdId', eqCtx: 'householdId' }, their_program_households: { field: 'householdId', inCtx: 'householdIdsInScopePrograms' }, keyholders: { flag: 'isKeyholder' } },
} as const satisfies ScopeBindings;

export const ROW_SCOPE_KEY = { EmergencyContact: 'householdId' };   // row-scoped models: fail closed if key absent
export const scopesHeld = makeScopesHeld(SCOPE_BINDINGS, ROW_SCOPE_KEY);
```

### 7.5 Corrections folded in from the analysis

- **`Visit` field name.** The source proposal wrote `{ field: 'departed', isNull: true }`. The schema
  field is **`departedAt`** (`schema.prisma:764`; the live switch already uses `row.departedAt == null`,
  `access-resolvers.ts:226`). Corrected above. This is the exact typo class the validator catches —
  and the fact that the careful source author still tripped it is the strongest argument for landing
  **S3 (the validator) before any large hand-authored binding work**, including §9.
- **`ToolStatus`.** Source proposal wrote `field: 'userId'`. Main renamed `ToolStatus.userId →
  participantId` (#564). Live verified: it **is** `participantId`. Corrected above.
- **`RawBadgeLog`, not `RawBadgeEvent`.** The stoic table wrote `RawBadgeEvent`; the live model (in
  the switch and `classifications`) is **`RawBadgeLog`**. Corrected above.
- **`Fee` / `RSVP` grouped-case fields (live port, `claude/affectionate-neumann-495641`).** The switch
  groups `ProgramParticipant | ProgramVolunteer | Fee | RSVP` and reads *both* `programId` and
  `participantId`. But **`Fee` has no `participantId`** and **`RSVP` has no `programId`** — those reads
  are inert on real rows, but a verbatim binding references non-existent fields and the field-existence
  validator flags them (`Fee.participantId`, `RSVP.programId` — the typo-catcher doing its job).
  Narrowed above: `Fee` → `their_program_participants` (programId) only; `RSVP` → `their_own`
  (participantId) only. *The equivalence test caught this on the first port attempt — fixed the
  binding, not the test.* (`Fee` is in fact all-`public`, so its binding is harmless either way.)
- **`EmergencyContact` is already bound — the doc was stale.** The live switch binds it
  (`their_households` via `householdId`, with a `ROW_SCOPE_KEY` fail-closed entry). Earlier drafts of
  this doc listed it as *pending a route*; that was wrong. Added to the table; removed from the
  pending queue (§7.5.1); and in §9 it is an **already-bound Step-1 read**, not a Step-4 new-binding.
- **`ROW_SCOPE_KEY` fail-closed** must be carried into the engine — see the correction box in §7.3.

#### 7.5.1 No `OPT_OUT_PERMANENT` — auto-exempt the un-scopable, queue the rest

The source proposal used a single flat `OPT_OUT` set "to preserve current behavior." A hand-
maintained permanent opt-out list is the wrong tool: it is a place where mislabels hide. Walking the
proposal's own list proves the point — of its 11 entries, three have no sensitive fields at all
(`CorporationLead`, `Tool`, `SystemMetricLog`, so the coverage check never flags them); two are actually
scopable and route-deferrable (`Corporation` has a `leads→participantId` edge, `VolunteerDesignation`
a `createdById`); and `AuditLog` has an `actorId` — "can a member see their own audit trail" is a
real product question, not a settled "never."

The honest principle: **the only thing that warrants permanent exemption is a model that is
*structurally un-scopable* — sensitive fields but no foreign key by which any non-admin actor could
ever own a row** (`ErrorLog`, `DevLedger`, `BoardSettings`, NextAuth's `VerificationToken`). For
those, no `their_*` binding is even expressible. And that is a **derivable fact, not a human
assertion** — `isScopable()` (in `validateBindings` above) computes it from the classification map
and auto-exempts, logging each so a reviewer can challenge a wrong tier. So there is no permanent
list to maintain.

Two rules collapse the rest:

- **"Never leaves, even to admins" → tier the field `secret`** (already exempt from the coverage
  check, e.g. `VerificationToken.token`). Opt-out is for "leaves to admins only," not "never leaves."
- **"Admin-only by policy" is not opt-out either.** A model can have a `their_own` binding and still
  be admin-only — bind the scope, tier the sensitive fields `internal`, and never grant
  `their_own:internal` on any route. The tier enforces it. `BackgroundCheckAttestation` is the test
  case: the participant *owns* the row but must not see the safeguarding notes → bind `their_own`,
  tier the notes `internal`. No opt-out.

That leaves exactly one hand-maintained list — a **work queue** of sensitive, scopable models whose
scoped route is not built yet:

```ts
// Sensitive AND scopable, but the scoped route does not exist yet. A §9 migration moves each entry
// OUT of this set and INTO a real SCOPE_BINDINGS binding, in the same PR that ships its handler() route.
// The plan is done when this set is empty. There is NO permanent opt-out list — un-scopable models
// are auto-exempt by isScopable(); "never leaves" content is tiered `secret`.
export const OPT_OUT_PENDING_ROUTE = new Set<string>([
    // EmergencyContact is NOT here — it is already bound (their_households, ROW_SCOPE_KEY).
    'MembershipProcess',            // board/admin today; a household-facing status route is plausible
    'BackgroundCheckAttestation',   // bind their_own, but keep notes `internal` (see above) — confirm at migration
    'Corporation',                  // has leads→participantId; a corp-lead view is plausible
    'VolunteerDesignation',         // has createdById; confirm whether a self view is warranted
]);
```

> **Live-port findings (`claude/affectionate-neumann-495641`), resolved for Step 3 wiring.**
>
> **Drop bare `id` from `SCOPABLE_FIELDS` — and it sends no false message.** `field: 'id'` is a real
> scope field for `Participant`, `Household`, and `Program` (e.g. `their_own: { field: 'id', eqCtx:
> 'selfId' }`) — but all three are **bound**, so the coverage loop skips them *before* `isScopable`
> runs. `isScopable` only ever judges **unbound** models, and for an unbound model `id` is a bare
> primary key with no actor meaning. The truth about id-as-scope lives in the **bindings** (untouched),
> not in `SCOPABLE_FIELDS` (a coverage heuristic). So dropping `id` is honest. **Do not rename the
> `id` columns** — `id` is the PK every FK points at; renaming ripples through the whole schema to fix
> a non-problem. With `id` gone, the FK-less logs/settings auto-exempt: `BoardSettings`, `ErrorLog`,
> `SystemMetricLog`, `IntegrationErrorLog`, `DevLedger` (note the exact model names).
>
> **`AuditLog` → bind `their_own:actorId`, admin-only by tier-grant control (option B, via the
> existing rule above).** It has `actorId`, so `isScopable` correctly calls it scopable. Rather than a
> new opt-out set, apply §7.5.1's own *"admin-only by policy"* rule (the `BackgroundCheckAttestation`
> pattern): give it `AuditLog: { their_own: { field: 'actorId', eqCtx: 'selfId' } }`. Coverage is
> satisfied (it's *bound*); at runtime it stays **admin-only because no route grants
> `their_own:internal` on `AuditLog`** — only `everyones:internal` (admin) views see audit rows. The
> binding is runtime-inert today and future-proofs a careful "your own actions" view later without
> reopening the policy. *(Caveat: binding changes `scopesHeld('AuditLog', …)` from `{everyones}` to
> `{everyones, their_own}` on own rows — inert, but it diverges from the S0→S2 equivalence snapshot,
> so update that test to encode the intentional change, or confirm it is retired post-#573.)* No
> opt-out entry, no new set.
>
> **Later (ponytail): make `isScopable` structural, not a name list.** The field-name allowlist is a
> little fragile. The principled replacement — *when the validator is matured* — is to derive
> scopability from Prisma relations ("has an FK to an actor model `Participant`/`Household`, or to
> `Program`") instead of a hardcoded set. Then there is no field-name list to send any signal. Not
> needed for the gate; leave a `// ponytail: name-list heuristic; derive from schema FKs if it drifts`.

**Behavior is unchanged.** Every model that was admin-only stays admin-only: un-scopable ones via
`isScopable` auto-exemption, the queued ones because no route grants them a `their_*` token until §9
ships one. The validator input is just `OPT_OUT_PENDING_ROUTE` — no union, no permanent set.

### 7.6 Phasing (S0–S3, each independently shippable and reversible)

- **S0 — land the engine, unwired.** Add `Match`, `evalMatch`, `makeScopesHeld`, `validateBindings`
  (incl. `isScopable`), `SCOPE_BINDINGS`, and the single `OPT_OUT_PENDING_ROUTE` set in new files
  (`scopes.ts`, `scopeBindings.ts` under `src/security/`, CODEOWNERS-gated). Export the new resolver
  as `scopesHeldNext`. Nothing imports it. Old `scopesHeld` untouched → no behavior change possible.
- **S1 — equivalence gate.** Contract test asserting `scopesHeldNext === scopesHeld` (set equality)
  across every model × every caller persona × representative rows (personas built from the seed
  `npx tsx prisma/seed.ts`: anonymous, self-only member, household co-member, program lead, core
  volunteer, keyholder, board, sysadmin; rows: own / another's / in-program / out-of-program /
  active-visit / departed-visit). Must be green before S2.
- **S2 — flip + delete.** Point `stripper.ts` and the security tests at the new resolver (rename
  `scopesHeldNext` → `scopesHeld`, delete the old switch). Import/definition swap only. Keep the S1
  test as a regression guard for one release.
- **S3 — turn on the validators.** Wire `validateBindings(...)` as a CI check (asserts zero errors),
  plus the **third validator (§8)**. From here a field typo, a forgotten sensitive model, or an
  unresolvable route grant **fails the build**. **This is the payoff phase — the security value lands
  here.**

### 7.7 Follow-on (OUT OF SCOPE) — extract a shared security library

The source proposal's larger ambition — lift the generic engine (`Match`, `evalMatch`,
`makeScopesHeld`, the validators) into a shared package so future apps merged into the monorepo
inherit classification-enforcement + stripping + the validators by adopting the package — is a
**separate project, deliberately not in this plan.** Nothing in S0–S3 or §9 depends on it, and it
depends on nothing here beyond "the engine is already a clean function over a data table," which S0–S2
deliver as a side effect. Defer it until a second app actually needs it (YAGNI); doing it now is
building library infrastructure for a consumer that does not exist. When that app arrives, the lift is
mechanical because the generic/data seam is already drawn. **Priority order for this plan is
explicit: ship the security checks and the PII route migration first; package extraction never blocks
or precedes them.**

---

## 8. The third validator — route-grant ↔ binding-scope (the seam check)

§7's validator proves *every sensitive model is bound*. It does **not** prove *every `scope:tier`
token a route grants in `orderedView` is resolvable on the model(s) that route returns*. That gap is
the seam in §6.3, and §9 is what stresses it: a registry entry can grant
`['programLeadMentor', ['their_program_households:pii']]` on a route whose returned model's binding
has no `their_program_households` scope → the stripper silently strips → the lead sees nothing. No
existing check fires, because the grant lives in `registry.ts` and the resolution lives in
`SCOPE_BINDINGS`, and nothing compares them.

**Blocker to writing the check:** routes do not *declare* the models they return — `handler()`
infers them from the bag at runtime (`stripBag`, `handler.ts:113`). So the seam validator needs each
`RouteSpec` to declare its return surface. This is a small, additive registry change and §9 should
adopt it as routes are migrated:

```ts
export interface RouteSpec {
    endpoint: string;
    authorize: Authorize;
    envelope: Envelope;
    orderedView: readonly OrderedViewEntry[];
    returns?: readonly (keyof Models)[];   // NEW: the model(s) this route's bag may contain
}
```

> **Wiring note (branch `claude/silly-khayyam-ee39e3` already adds this field).** That branch types
> `returns` as **optional** (`Models[] | undefined`). The seam validator must therefore treat
> `returns === undefined` as `[]` and **skip** the route — un-migrated routes simply aren't checked
> yet, and the check tightens automatically as each route declares its `returns`. This composes
> cleanly with the S0–S2 work (branch `claude/affectionate-neumann-495641`), which authored
> `validateRouteGrants` but could not wire it precisely because this field didn't exist yet.

**The validator (shared, CI):**

```ts
// For every route, every scope referenced by every token it grants must be resolvable
// on at least one model the route can return.
export function validateRouteGrants(
    routes: Iterable<RouteSpec>,
    bindings: ScopeBindings,
): string[] {
    const errors: string[] = [];
    for (const spec of routes) {
        const grantedScopes = new Set<Scope>();
        for (const [, tokens] of spec.orderedView) {
            for (const tok of tokens) {
                const parsed = parseToken(tok);
                if (parsed && parsed !== 'public' && parsed !== 'member') grantedScopes.add(parsed.scope);
            }
        }
        // 'everyones' is seeded on every row by the engine — never needs a binding.
        for (const scope of grantedScopes) {
            if (scope === 'everyones') continue;
            const resolvableOnSomeReturn = spec.returns.some(
                model => bindings[model] && scope in bindings[model]!,
            );
            if (!resolvableOnSomeReturn)
                errors.push(
                    `${spec.endpoint}: grants '${scope}:*' but none of its returns [${spec.returns.join(', ')}] ` +
                    `bind '${scope}' — that grant silently resolves to nothing (over-restriction).`,
                );
        }
    }
    return errors;
}
```

What it catches that the other two miss:
- a route grants a scope the returned model doesn't bind (typo or wrong scope) → **silent
  over-restriction**, today invisible because it fails safe;
- the inverse smell — a route declares `returns: ['X']` but its handler returns model `Y` (the bag
  key) — is *already* caught at runtime by `stripBag`'s "bag key is not a known model" warning
  (`stripper.ts`), and can be promoted to a test by asserting `returns` matches the bag keys the
  route's tests observe.

This is the check that makes §7's verifiability actually reach the wire: §7 proves the resolver is
honest about *rows*; §8 proves the routes are honest about *grants*; together they close the loop
that the half-rule left open.

> Scope note: `everyones`-tier grants (admin views — `everyones:pii` etc.) need no binding (the
> engine seeds `everyones` on every row), so they are skipped. The check only bites on the
> row-scoped tokens (`their_*`, `keyholders`, `all_current_visitors`) — which is exactly the set §9
> introduces at scale.

---

## 9. Execution plan — ordered steps from the post-#1/#2 baseline

**Baseline (assumed, see header):** Migration #1 (chaum + spence) and #2 (`withKiosk`/`scan`) are
landed. Every route enters through `withAuth` / `withCron` / `withWebhook` / `withKiosk`;
`authenticateRequest` has no direct route callers; admission is uniform; **authorization is still
hand-rolled inline in ~69 `withAuth` routes**, and only 7 routes strip fields.

**Priority order is explicit and security-first:** (1) stop the active PII leaks, (2) lock them with
CI validators, (3) only then the uniformity/cleanup refactors. The scope-resolver conversion (§7) is
included **solely because the validators can't exist without it** — it is the minimum enabler, not a
goal. Library/package extraction (§7.7) is a separate later project and **never precedes or blocks**
any step here.

> **POST-MERGE STATUS (2026-06-30): Steps 1–2 are merged (#568–#573); the live frontier is Step 3.**
> Steps 1 and 2 below are kept for rationale but are largely done. **The actionable work is Step 3 —
> turn the authored-but-toothless validators into a green, build-failing gate.** That is blocked by
> three concrete items, all surfaced by the merged code itself and detailed in Step 3. Jump there.

### Step 1 — Ship the leak fix: already-bound PII reads ✅ *largely merged (#571, #572)*
**Remaining:** `shop/members` (verify the §9.1 certifier decision as merged) and `household/emergency-contacts`
(already-bound via `EmergencyContact` → add the `handler()` route). The rest of this step is in main.

> **⚠️ Step 1b — HIGHEST SEVERITY, do now: `GET /api/programs/[id]` association leak (§5.1a).** This
> route is *already* on `handler()` but `authorize: 'public'` + the `anyone → ['public']` view returns
> the **enrollment roster (participant names) to unauthenticated callers** — stripping can't fix it
> (names are public-tier). This is **not a migration** (it's already a handler route); it is a
> **query-shaping fix**: keep program metadata public, but only `include` the `participants` /
> `volunteers` associations when the caller is staff or enrolled (decide in the handler fn, which has
> the role context). Reachable with no session — treat as the top priority of the whole plan.

Start with **`GET /api/events/[id]`** (top-10 #1) as the template: add its `defineRoute` entry with
`returns: ['Event']`, move the inline `isLeadMentor || isCoreVolunteer || isSysAdminOrBoard` into
`authorize` + `orderedView`, delete the body's 403, add a strip test (lead sees PII; non-staff
stripped). `Event` is already bound, so stripping works against **today's** resolver — this PR ships
real PII protection on day one. *(Already queued as the active `events/[id]` chip.)*

Then roll the same shape to the rest of the **already-bound** reads — no §7 dependency:
`events/[id]`, `programs/[id]/eligible-participants` (the genuine PII reads of the program family;
the sibling write routes `events/[id]/attendance`, `programs/[id]/participants`,
`programs/[id]/volunteers` are POST/DELETE-only → `withAuth`, no roster GET to strip), then
`finance-ops/payment-plans` (board/sysadmin → `everyones` view; returns
`ProgramParticipant`+`Participant`+`Program`, all bound), and **`household/emergency-contacts`**
(`authorize: 'household-lead'`; `EmergencyContact` is already bound via `their_households` +
`ROW_SCOPE_KEY`, so this too works against today's resolver). **This is the bulk of the actual
security win and it does not wait for anything below.**

> Branch `claude/funny-hugle-f78899` already migrates `events/[id]` and
> `programs/[id]/eligible-participants` to `handler()` (reads) and the three sibling write routes to
> `withAuth` — i.e. the program-family half of this step. Remaining Step-1 routes:
> `finance-ops/payment-plans`, `shop/members`, `household/emergency-contacts`.

> **Two corrections to the original top-10:** (a) "trusted-adults (list)" is **not** a read route —
> `trusted-adults/route.ts` is POST-only (a write); the trusted-adult *reads* (`mine`, `operational`)
> are already on `handler()`. Removed. (b) `shop/members` is **not** a clean template: its gate is
> sysadmin/board **OR certifier**, and *certifier* is a `toolStatus` (`MAY_CERTIFY_OTHERS`), not a
> `BusinessRole` in the `Authorize` grammar (`core.ts`). It still belongs in Step 1 (returns
> `Participant {name,email}`, bound) but needs an authorize decision first — see §9.1.

#### 9.1 Decision — `shop/members` and the certifier `toolStatus`

handler's admission grammar (`Authorize`, `core.ts:116`) admits global `BusinessRole` flags,
`self`, household/program relations — but **not** certifier, which lives on
`session.user.toolStatuses` as `level === 'MAY_CERTIFY_OTHERS'`. Two ways forward:

- **(A, recommended) extend `Authorize` with a `certifier` admission gate** backed by a
  `resolveAccess` predicate that reads `toolStatuses`. Certifier-as-toolStatus is a recurring concept
  (it gates the shop surfaces); making it a first-class admission term keeps the rule "all
  authorization is declared" and pays off beyond this route. Small additive change to
  `core.ts`/`access-resolvers.ts` (CODEOWNERS-gated).
- **(B) split the route:** register `authorize: { anyRole: ['isSysadmin','isBoardMember'] }` and keep
  the certifier branch as a *documented exception* in the body. Smaller diff, but re-introduces the
  "hand-rolled authz in the body" pattern this whole effort removes — only if (A) is blocked.

Separate from admission: the **view**. `shop/members` returns every active member's `email` (pii) to
a certifier. The `Participant` bindings (`their_own`/`their_households`/`their_program_*`) do **not**
grant a certifier arbitrary members' pii, so the route must grant `everyones` to that role — an
admin-tier view. **Confirm that is intended** (does a certifier need every member's email, or just
`name` + a contactable handle?). This is the one Step-1 route where the migration should *reduce*
what leaks, not just declare the status quo.

### Step 2 — Stand up the validation substrate, minimal ✅ *merged (#573)*
Convert the `scopesHeld` switch to the declarative table so the validators become possible — and
nothing more (no package, no generic homes; §7.7 is out of scope):
- **S0:** author `scopes.ts` (interpreter + `validateBindings` incl. `isScopable` + `validateRouteGrants`)
  and `scopeBindings.ts` (`SCOPE_BINDINGS` + `OPT_OUT_PENDING_ROUTE`). Verify
  `ToolStatus`/`Account`/`Session` field names live (§7.5). Export `scopesHeldNext`, wire nothing.
- **S1:** equivalence test `scopesHeldNext === scopesHeld` across personas × models × rows.
- **S2:** flip `stripper.ts` to the new resolver, delete the switch. Behavior-identical (S1 proves it).

Runs in parallel with Step 1 — they touch different files (Step 1: `registry.ts` + route bodies;
Step 2: `access-resolvers.ts` + new files). The already-bound Step 1 routes keep working throughout.

> **#573 (`affectionate-neumann`) implements S0–S2** (S1 equivalence green). It carried the
> `ROW_SCOPE_KEY` fail-closed guard (§7.3 box) the original sketch dropped. But it did **not** narrow
> the `Fee`/`RSVP` bindings — it kept the literal port and **pinned the resulting field-existence
> errors as a "known finding"** in `tests/security/scopeValidators.test.ts`. So the bindings still
> reference non-existent fields, and the validator still returns errors. That, plus `id`-in-
> `SCOPABLE_FIELDS` and the missing `returns` on 10/12 routes, is exactly why Step 3 below cannot yet
> be a gate.

### Step 3 — Make the validator gate green, then wire it ⚠️ *THE LIVE FRONTIER (2026-06-30)*

The three validators are authored and unit-tested (`scopeValidators.test.ts`), and `RouteSpec.returns?`
exists. But `validateBindings(SCOPE_BINDINGS, …)` is **not green** and is **not wired as a build
gate** — the test pins the current errors instead of asserting zero. Three blockers, all in the
merged code, must clear first. None is large; each is a small, equivalence-preserving fix.

**Blocker 1 — narrow the `Fee`/`RSVP` bindings (`scopeBindings.ts:77–90`).** They still carry
`Fee.their_own:participantId` (Fee has no `participantId`) and `RSVP.their_program_participants:programId`
(RSVP has no `programId`). Drop those two entries (Fee → `their_program_participants` only; RSVP →
`their_own` only). The fields are inert on real rows — they were **dead in the switch too**
(`num(row.programId)` on an RSVP is always `undefined`) — so this is **equivalence-preserving** (S1
stays green) and removes the two pinned `field-existence` errors. Then change `scopeValidators.test.ts`
from *pinning* `Fee.participantId`/`RSVP.programId` to asserting they are **gone**.

> **Intent, so the drop doesn't erase it.** `Fee` is a program's price tier with no participant owner
> and is **all-`public`** — `their_own` was spurious copy-paste, and Fee needs no binding at all
> (delete the entry if you like; coverage won't flag an all-public model). `RSVP`, though, has a
> *real* latent intent behind the dead grant: "a program lead sees RSVPs (incl. `reminderSentAt`,
> `internal`) for their program's events." That can't be expressed today — `RSVP` reaches a program
> only via `eventId → Event.programId` (a relation hop), and `CallerContext` has no
> `eventIdsInScopePrograms` set. Dropping is still correct (it was never granted at runtime), but if
> that view is wanted it is a **new capability** — add `eventIdsInScopePrograms` to
> `buildCallerContext`, then `RSVP: { their_program_participants: { field: 'eventId', inCtx:
> 'eventIdsInScopePrograms' } }` — **filed separately, not in the gate-fix PR.**

**Blocker 2 — drop bare `id` from `SCOPABLE_FIELDS` (`scopes.ts:154`), park `AuditLog`.** With `id`
present, every admin-only log/settings table (all have an `id`) is judged "scopable" and the coverage
check flags `AuditLog`/`BoardSettings`/`ErrorLog`/`SystemMetricLog`/`IntegrationErrorLog`/`DevLedger`.
- **Drop `id`** (decided — full reasoning in §7.5.1): it sends no false message because the valuable
  `field: 'id'` scoping (Participant/Household/Program) lives in the **bindings**, which are bound and
  never reach `isScopable`; the heuristic only judges *unbound* models, where `id` is a bare PK. **Do
  not rename the `id` columns** (PK rename ripples through every FK to fix a non-problem). Add a
  one-line comment, and a `// ponytail: name-list heuristic; derive from schema FKs if it drifts` for
  the later structural version. Dropping `id` auto-exempts the five FK-less logs/settings.
- **`AuditLog` → bind `their_own:actorId`, admin-only by tier-grant control (option B, decided).** It
  has `actorId` so it stays "scopable"; audit rows record who-did-what-to-whom (incl. staff actions on
  members), so exposing them to the actor leaks investigation/safeguarding context — keep it
  admin-only. Rather than a new opt-out set, apply §7.5.1's *"admin-only by policy"* rule: add
  `AuditLog: { their_own: { field: 'actorId', eqCtx: 'selfId' } }`. Coverage passes (bound); runtime
  stays admin-only because **no route grants `their_own:internal` on `AuditLog`**. Update the S0→S2
  equivalence test for the (inert) `scopesHeld` change — see §7.5.1.

**Blocker 3 — backfill `returns:` on the registered routes (`registry.ts`), and make the function
tolerate undefined.** Only **2 of 12** entries declare `returns` (`finance-ops/payment-plans`,
`shop/members` — from #572). Two distinct problems:

- **The function *throws*, it doesn't skip.** `validateRouteGrants` does `spec.returns.some(...)` with
  **no undefined guard** (`scopes.ts`), so calling it over `allRoutes()` would throw on the first of
  the 10 routes lacking `returns`. **First fix is one line:** `const returns = spec.returns ?? []; if
  (!returns.length) continue;` — skip undeclared routes (per §8 / the optional-by-design contract).
  This gives **incremental coverage**: the gate goes green now checking only declared routes and
  tightens as each `returns` is added — no big-bang requirement.
- **Backfill is not uniform — only the row-scoped granters are load-bearing.** The check only bites on
  routes granting a row-scoped token (`their_*` / `keyholders` / `all_current_visitors`); `everyones`
  is seeded on every row and skipped. So:

  | needs `returns` (grants row-scoped — a typo'd scope silently strips) | `returns` moot for this check (grants only `everyones:*` + member/public) |
  |---|---|
  | `profile`, `programs/[id]`, `events/[id]`, `eligible-participants`, `trusted-adults/mine`, `trusted-adults/operational` | `directory/board`, `membership-ops/applications`, `safety/trusted-adults`, `membership/reviews` |

  Backfill the **left column first** (`returns` = the model keys the handler's bag contains, read off
  its `return { Model: … }`). The right column is hygiene only (it also enables the inverse `returns`
  vs bag-key check that `stripBag` warns on at runtime), not load-bearing for the seam validator.
  **Expect the backfill to surface real mismatches** — a route granting a scope its returned models
  don't bind. That is the validator working; verify each before the gate locks.

**Then wire the gate** (only after Blockers 1+2 make `validateBindings` clean): replace the
pinned-error assertions with
`expect(validateBindings(SCOPE_BINDINGS, classifications, OPT_OUT_PENDING_ROUTE)).toEqual([])` and
`expect(validateRouteGrants(allRoutes(), SCOPE_BINDINGS)).toEqual([])`, kept as their own CI test
(`allRoutes()` lives in `core.ts`). From here every route PR is mechanically checked — a grant that
can't resolve **fails the build** instead of silently over-restricting. This is the payoff: the
half-rule's silent-over-restriction class becomes a build error.

### Step 4 — Finish any PII reads that need a *new* binding *(security, under validator cover)*
`EmergencyContact` is **already bound** (it moved to Step 1), so the only candidate left is:
- `notifications` (#9) — confirm the returned model. If it's an unbound sensitive model, add the
  binding **same PR** as the route; the seam validator (Step 3) confirms the grant resolves. If it
  returns only the caller's own rows (likely), a `self` authorize + `their_own` binding covers it.

This step is now nearly empty — the live resolver already binds more than the doc originally assumed.
Read-side done when the top-10 routes are migrated and `OPT_OUT_PENDING_ROUTE` is drained by whichever
later routes expose its 4 remaining models (`MembershipProcess`, `BackgroundCheckAttestation`,
`Corporation`, `VolunteerDesignation`).

### Step 5 — Backfill the remaining authenticated routes
The remaining surface (post-merge: ~36 `withAuth` reads + ~43 write-only). **None is a broadly-admitted
cross-participant leak** — those (top-10, `programs/[id]`) are done. So this is four parts, ordered
by residual value. Every migrated route gets an `authorize` + `returns` entry so the seam validator
(Step 3) covers it.

**5a — admin/staff PII reads → `handler()` + `everyones` view *(backstop value — but only RAW-ROW
routes).*** Reads gated to `isSysadmin`/`isBoardMember`/`isKeyholder` that return
`name`/`email`/`dateOfBirth` with **no stripping backstop** (over-`include` risk). Admission is already
tight, so this guards against a *future* over-include, not an open leak. Template = the
`finance-ops/payment-plans` migration (#572): `authorize: { anyRole: [...] }` +
`everyones:pii/personal/internal` view + `returns:`.

> **⚠️ Hard constraint discovered migrating the first batch (`task_b2fedecb`): `handler()` emits only
> *classified model fields* + relations. It silently drops *computed/derived* response fields.** The
> #572 template worked only because payment-plans/directory/shop return **raw model rows** (lossless
> strip). Many admin reads return a **computed envelope** the frontend depends on — and those **must
> not** be force-migrated: it would drop the computed fields and break the page.
> - `participants/search` → computed `isMember` (badge Active/Inactive col) + nested household shape.
> - `safety/emergency-contacts` → heavy envelope: `isPresent`, back-compat `emergencyContactName/Phone`,
>   per-contact `invalid`, mapped participants/leads — the page is built on this shape.
> - `admin/broken-households` → renamed `members` + `name || "Household #id"` fallback.
>
> **Decision: these three stay on `withAuth` for now** — the backstop isn't worth a client-side
> recompute + page rewrite. **5a's real target is the RAW-ROW subset only** (verify each returns model
> rows, not a computed shape, before migrating). The envelope routes wait for the `derive` hook
> (Step 6 note). Likely raw-row candidates worth checking: `membership-audit/{unclaimed-households,
> households-missing-contact}`, `facility/{visits,badges}`, `membership-ops/households`. Verify-then-batch;
> do not assume payment-plans shape.

**5b — own-data reads → `handler()` + `self`/`their_own`.** `profile/{visits,onboarding-status}`,
`membership/{route,payment,renewal-status}`, `notifications` (the Step-4 leftover), `nav/todo-counts`,
`programs/mine`, `events/mine`. Self-scoped → low risk; convert for consistency.

**5c — role-gated writes → uniformity *(drift-guard payoff, not PII).*** The ~43 write-only routes
(`membership-ops/*`, `programs/[id]/{settings,publish,volunteers,…}`, `safety/*/{decision,override}`,
`trusted-adults/[id]/*`, …). They leak nothing on the wire, so this is for one admission path + the
drift-guard: declare `authorize`, drop the inline `403`s, add `returns`. Lowest priority.

**5d — system/config reads → uniformity.** `system-status/*`, `settings/membership/*`,
`admin/settings/*`. Internal/admin data, minimal participant PII.

### Step 6 — Collapse `withAuth` into a degenerate `handler()` *(cleanup — BLOCKED on the `derive` hook)*

The original idea — make `withAuth` a thin wrapper that registers a permissive policy and calls
`handler()` — has a **correction from the 5a finding**: a permissive `orderedView` is **NOT** "stripper
a no-op." The stripper emits only *classified model fields* regardless of view tokens (the view
controls *tiers*, not *passthrough*). So **any** `handler()` path drops a route's computed/derived
response fields. Many `withAuth` routes return computed envelopes (`isMember`, `isPresent`, `invalid`,
back-compat names, renamed relations). Therefore **`withAuth` cannot be collapsed into `handler()`
until `handler()` can host computed fields** — otherwise the collapse silently breaks every
envelope route's frontend.

**Prerequisite — add a fail-closed `derive` hook to `handler()`:**
```ts
handler(endpoint, fn, { derive: (strippedBag, ctx) => extraFields })
```
It runs **after** `stripBag`, on **already-visible** data only, and merges its result into the
envelope. Fail-closed by construction: a computed field whose inputs were stripped for this caller
simply can't be built, so it can't leak (for admin `everyones` views nothing is stripped, so
derivation has all inputs). This is a small, gated `handler.ts` addition. With it: (1) the envelope
reads pulled from 5a can migrate, computing server-side as today; (2) the `withAuth`→`handler`
collapse becomes safe. Without it, envelope routes stay on `withAuth` permanently and "one admission
path" is unreachable. **Decide this hook before committing to Step 6.**

After the hook: make `withAuth` register a permissive policy + call `handler()` — **one admission
code path**. Delete `src/lib/auth.ts`'s `roles`/admission logic; `authenticateRequest` survives as the
internal primitive shared by the four wrappers.

### Step 7 — Lock it with the drift-guard *(HIGHEST-LEVERAGE REMAINING ITEM — preventive security, not hygiene)*
CI test that fails on any new `getServerSession` / `authenticateRequest` import outside the wrapper
libs, and on any route file that calls `prisma` without a registered policy (extend the registry's
existing throw-on-unknown-role, `core.ts:162`, into a coverage test over `src/app/api/**`).

> **This is the single most valuable remaining item, and it is *security*, not cleanup — proven by
> the fact that drift has *already re-grown* since the migration.** The doc once recorded 2
> `getServerSession` routes; current `origin/main` has **6 files** using it (`attendance`, `programs`,
> `programs/[id]`, `shop/certifications`, `shop/tools`, `auth/dev-personas`), and **GAP-1** (§10) — a
> live denied-household-lockout bypass on `programs/[id]` PATCH and `shop/certifications` POST — is a
> re-grown instance of risk #2. New routes keep reaching for `getServerSession` because nothing stops
> them. Every other remaining item is uniformity/backstop; this one *prevents the next real gap*.
>
> **Prerequisite:** the guard fails on the existing 6 until they're converted. So Step 7 = (1) convert
> the remaining `getServerSession` usages, then (2) add the CI guard. GAP-1's one-line fixes (chip,
> §10) close the live holes now; this closes the *class*.
>
> **Refinement found during conversion (`task_8659e031`): not all 6 are mandatory-session.** The
> *writes* (`programs/[id]` PATCH, `shop/certifications` POST, `shop/tools` POST) → `withAuth({})`,
> which also fixes GAP-1. But three are **optional-session** — they legitimately serve **anonymous**
> callers and `withAuth` would 401 them: `attendance` GET (kiosk + anonymous), `programs` GET
> (anonymous public catalog, test-asserted at `programsAPI.integration.test.ts:91`), and
> `dev-personas` GET (dev login path). `withAuth` is mandatory-session, so it can't express these.
> The fix is a **sanctioned `getOptionalSessionUser()` in `lib/auth.ts`** built on the *existing*
> `authenticateRequest` (so the denied gate is reused, not re-implemented — a second denied check is
> the GAP-1 class): `return auth.type === 'session' ? auth.user : undefined`. A denied household falls
> through to `undefined` → public-only, fail-closed. This **completes the wrapper family**:
> `withAuth`/`handler` (mandatory session) · `getOptionalSessionUser`/`authenticateRequest` (optional
> session) · `withCron`/`withWebhook`/`withKiosk` (non-session). The phase-2 drift-guard bans raw
> `getServerSession` in `app/api/**` and sanctions exactly these entry points (all in `lib/auth.ts`);
> `getOptionalSessionUser` is for genuinely-public reads only, **not** an escape hatch from `withAuth`.

### Dependency summary (post-merge 2026-06-30)
```
✅ #568/#569 (#1)  ✅ #570 (#2)  ✅ #571/#572 (Step1*)  ✅ #573 (Step2) ─► [merged baseline]
                                                                              │
  NOW ►  Step3 (make validator gate green + wire it) ── 3 blockers, §9 ──► Step4 (notifications, near-empty)
                                                                              │
  CLEANUP:                                                      Step5 ─► Step6 ─► Step7
```
`*` Step 1 remainder: `shop/members` certifier check + `household/emergency-contacts` route. The
critical path is now **Step 3**: narrow Fee/RSVP, drop `id` from SCOPABLE_FIELDS, backfill `returns:`,
flip the test to a zero-error gate. Steps 5–7 are uniformity/cleanup. **§7.7 (library extraction)
appears nowhere on this path.**

### Definition of done
- ✅ Admission unified: four typed front doors (`withAuth`/`withCron`/`withWebhook`/`withKiosk`);
  `authenticateRequest` internal-only; getServerSession down to 2 (dev-personas + one mixed write).
- ✅ PII reads strip fields on the merged routes (no enumerable-ID roster leak — closes risk #1 for
  the program family + payment-plans + shop/members). **Remaining:** emergency-contacts route.
- ⚠️ **Three CI validators GREEN and GATING** (field-existence, model-coverage incl. `isScopable`
  auto-exempt, route-grant resolvability) — **this is the open item.** `OPT_OUT_PENDING_ROUTE` drains
  to empty as later routes expose its 4 models.
- Later: collapse `withAuth` into degenerate `handler()`; zero `if (...) return 403` in bodies;
  drift-guard. Delete `SCOPE_BINDINGS_MIGRATION.md`. Library extraction deferred to §7.7.

---

## 10. Security-gap vs cleanup triage (verdict)

**Headline:** the real leaks are closed (top-10, `programs/[id]` #575). The remaining ~36 reads / ~43
writes are uniformity / backstop / drift-guard. The single remaining item that is genuinely *security*
is the **drift-guard (Step 7)** — preventive, because the class it guards has already re-grown.
`derive`-hook / Step 6 collapse = cleanup (admission is already correct; no leak depends on it).

### GAP-1 — denied-household lockout bypass *(low severity, real, fixed in-flight)*
Two `getServerSession` write paths gate on a signal that **survives denial** (per `authClaims.ts:33`,
denial strips role flags + toolStatuses but keeps `id`): `programs/[id]` PATCH (gates on
`leadMentorId === user.id`) and `shop/certifications` POST (re-queries certifier status from the DB,
not the stripped session). A denied lead-mentor / certifier still acts. One-line `if
(session.user.denied) return 401` each (mirroring `attendance/route.ts:21`), or — root fix — convert
to `withAuth`, which enforces the denied gate for free. Both queued.

### GAP-2 — IDOR via hand-rolled row checks *(the structural class)*
`withAuth` does admission only; **49 of 63** sites pass no roles (`auth.ts:69`) and re-implement "is
this my row?" inline. Each is an independent chance to forget the ownership check → IDOR. The team
already hit one (`fd192fc`, trusted-adult "assert no mutation after IDOR 403"). The lever is
declarative `authorize` (collapses 69 review surfaces into one CODEOWNERS-gated registry).

**Calibration — what is and isn't actually closed (the part that matters in practice):**

- **The validators do NOT detect IDOR.** IDOR is *under-restriction*; the checks catch the opposite or
  adjacent: `validateBindings` (models bound), `validateRouteGrants` (grants *resolve* → catches
  **over**-restriction). **No check judges whether a grant is too *permissive*** — a route handing
  `everyones:pii` to `authenticated` passes every validator. Appropriateness is caught by **CODEOWNERS
  review of `registry.ts` + negative tests**, not by a green gate. So "the gate stops the next IDOR"
  is false; the gate ensures *consistency*, not *tightness*.
- **The runtime anti-IDOR is per-row scope stripping** (`scopesHeld`+`stripBag`) — and it covers only
  **reads of sensitive-tier fields**. It cannot touch: (1) IDOR reads of **public-tier** data
  (names/existence — the §5.1a association class); (2) **any write** (stripping is a response filter;
  the mutation already happened). A write is gated *only* by `authorize`, and only if `authorize` is
  row-aware.
- **Most of the "69" are NOT live IDOR.** Sensitive-field reads → stripping covers; role-gated reads →
  admission covers; writes whose `[id]` *is* the owned entity (`programs/[id]/*`, `shop/tools/[id]`,
  `membership-ops/*`) → declarative `authorize` (`program-lead-mentor` / `{anyRole}`) closes them.

**The residual IDOR-write surface (what actually matters — ~6 endpoints).** Mutations whose `[id]`
names a **child** entity and whose ownership lives on a **parent relation** the param-keyed `authorize`
grammar can't express, so the gate stays inline and forgettable:

| endpoint | `[id]` → owner hop | current gate | note |
|---|---|---|---|
| `events/[id]` PATCH | event → program lead | inline `leadMentorId === user.id` | was GAP-1-adjacent |
| `events/[id]/attendance` POST | event → program lead | inline (`route.ts:25`) | under-tested |
| `events/[id]/rsvp` PATCH | event → program participant | inline 403 | under-tested |
| `household/emergency-contacts/[contactId]` PATCH/DELETE | contact → household lead | inline + **query scoped to `householdId`** | better-defended |
| `trusted-adults/[id]/renew` POST | trustedAdult → household/subject | service-layer check | **has** `fd192fc` IDOR test |
| `trusted-adults/[id]/withdraw` POST | trustedAdult → household/subject | service-layer check | **has** `fd192fc` IDOR test |

These stay inline even after the full migration — the param-keyed grammar genuinely can't express the
hop. **Two levers, neither is the validator gate:**
1. **Lift the hop into `CallerContext`** so it becomes declarative — *where the gate is uniform.* A
   resolver that puts the relation in `CallerContext` lets a route use a declared `authorize` instead
   of an inline `if`. This works when a route's ownership is one clean predicate.
   > **But NOT for `events/[id]*` — verified against the code, do not attempt the obvious fold.** The
   > tempting move is to reuse the RSVP capability's `eventIdsInScopePrograms` (events in programs I
   > lead ∪ core-vol) as an `authorize` term for the events routes. It does not fit, for three reasons:
   > (a) **wrong granularity** — `attendance` POST and the PATCH edit/cancel branch gate on `leadMentor`
   > **only**, but the RSVP set is `lead ∪ core-vol`; reusing it would *widen* access (core-vols gain
   > attendance-validation/edit) — a silent privilege escalation, not a lift. (b) **`rsvp` PATCH gates on
   > *enrollment*** (`ProgramParticipant`), a different relation the RSVP set doesn't compute. (c)
   > **`events/[id]` PATCH is multi-conditional** — lead-only for edit/cancel, lead∪core-vol for
   > attendance-confirm, *within the same route* — so a single `authorize` term can't replace it; the
   > inline branching stays regardless. A correct lift would need bespoke per-route sets (`eventIdsLed`,
   > `enrolledEventIds`) AND still leave inline branching → low ROI. **`eventIdsInScopePrograms` stays
   > RSVP-only; the events/[id] routes keep their inline gates as the accepted relation-hop exception.**
2. **Negative tests (the `fd192fc` pattern) as the backstop** — this is the *primary* lever for the
   events residue, since lever 1 doesn't apply there. `trusted-adults` has them; **`events/[id]/attendance`,
   `events/[id]/rsvp`, and `emergency-contacts/[contactId]` are the under-tested ones to prioritize**
   (chip `task_f13cfe70`).

**Verdict on GAP-2:** "closed" = *declared + CODEOWNERS-reviewed + sensitive-reads-stripped*, **not**
mechanically IDOR-proof. The open piece is not the validator gate (consistency, ships soon) — it is the
relation-hop **write** residue above, which needs `CallerContext` extensions + targeted tests.

### Drift-guard (Step 7) — preventive security, not hygiene
Proof it's security: the doc once recorded 2 `getServerSession` routes; `origin/main` is back to **6
usages**, and GAP-1 is a re-grown risk-#2 instance. New routes keep reaching for `getServerSession`
because nothing stops them. The guard stops the *class*. (Subtlety: not every inline `403` is drift —
relation-hop gates like the §10 table are an accepted, must-be-commented exception; distinguish them
from un-migrated drift.)

---

## Appendix — exact mechanism inventory (main, post-correction)

- **handler() (7):** `directory/board`, `membership-ops/applications`, `membership/reviews`*,
  `profile`*, `safety/trusted-adults`, `trusted-adults/mine`, `trusted-adults/operational`
  (*=mixed with withAuth). Registry: `src/security/registry.ts:14-122`.
- **getServerSession (20):** `attendance/manual`, `attendance`, `auth/dev-personas`,
  `events/[id]/attendance`, `events/[id]`, `events/[id]/rsvp`, `events/mine`, `events`,
  `finance-ops/payment-plans`, `programs/[id]/eligible-participants`, `programs/[id]/participants`,
  `programs/[id]/publish`, `programs/[id]/request-payment-plan`, `programs/[id]`,
  `programs/[id]/settings`, `programs/[id]/volunteers`, `programs/mine`, `programs`, `shop/members`,
  `shop/tools/[id]`. **→ chaum converts all 20.**
- **cron (6):** all `cron/*`, guard `requireCronSecret` (`src/lib/cronAuth.ts`). **→ spence wraps in
  withCron.**
- **webhook (2):** `webhooks/shopify`, `webhooks/zoho`. **→ spence wraps in withWebhook.**
- **authenticateRequest direct (1):** `scan` (`scan/route.ts:20`, kiosk + body signature).
- **unguarded/public (4):** `auth/[...nextauth]` (NextAuth mount), `health`,
  `system-status/kiosk-version`, `programs/[id]/public-register`.
- **withAuth (63 files):** the remainder — of which **49 call sites pass no `roles`**
  (admission-only; `src/lib/auth.ts:69`).
