# Design: The Dev Instance & Impersonation Model

**Status:** Proposed (for review)
**Audience:** checkin maintainers + AI contributors (see `CONSTITUTION.md`)
**Origin:** AWS deployment design. We are standing up two cloud environments —
`checkin` **prod** and a **dev** instance — both behind a shared ALB. This doc defines how the
dev instance behaves and replaces the current environment-gated auth shortcuts with a single,
safer model.

---

## 1. Why this exists (goals)

The dev instance must let trusted humans exercise the *real* app with *throwaway* data. Concretely:

1. **Reachable from anywhere** — key volunteers and board members test from any device, no VPN, no
   IP allow-list, no requirement to run locally.
2. **Minimal auth states** — the smallest possible number of flags. No cross-product of
   `NODE_ENV` × `NEXT_PUBLIC_DEV_AUTH` × "is a kiosk key set" to reason about.
3. **Never touches prod data** — the dev instance physically cannot read or write production data.
4. **Impersonation is clear** — when you act as a persona, it's unambiguous who you really are.
5. **Not world-readable** — an anonymous visitor (or a bot) can see *nothing* but the login screen.
6. **No accidental clobbering** — a shared instance shows who tested/reset last, so you don't
   stomp a colleague's session, with a deliberate reset.

---

## 2. Constitution alignment (read this first)

`CONSTITUTION.md` prohibits features that bypass or weaken security checks, and asks contributors
to reject auth-weakening changes. **This design strengthens security on net:**

- It **deletes** the two existing environment-gated shortcuts that *do* weaken auth in non-prod:
  - `NEXT_PUBLIC_DEV_AUTH` "Development Mock Auth" — logs anyone in as anyone with no credential
    (`src/lib/auth-options.ts`).
  - The `NODE_ENV`-keyed kiosk fallback — treats any cookieless request as an authenticated kiosk
    when no key is configured (`src/lib/auth.ts:31-35`, via `config.isDev` in `src/lib/config.ts:30`).
- It replaces them with a single capability that is **dead in production by construction**, gated on
  **verified org identity**, and **structurally unable to reach prod data**.
- It does **not** alter the production authentication flow, RBAC, or kiosk signature verification.

The impersonation capability is powerful, so it is fenced on three independent sides (env + verified
identity + data isolation), described below. None of the production code paths change behavior.

---

## 3. The one flag: `CHECKIN_ENV`

All environment personality collapses into a **single runtime variable** (principle 2):

```
CHECKIN_ENV = prod | dev | local      # default (unset) = prod
```

- `prod`  — production. Real data, public landing page, real Google login, no dashboard, no impersonation.
- `dev`   — the cloud dev instance. Entire site behind org login; impersonation dashboard enabled.
- `local` — a developer laptop. Same dashboard; additionally permits **offline** credential login
  (no Google needed). Never set in any deployed environment.

**`NODE_ENV` is no longer an auth switch.** It stays `production` in *both* cloud environments (it
governs framework correctness — the standalone `server.js` is a production build artifact and must
run as `production`; running it as `development` degrades React/Next and re-enables footguns). Auth
code branches on `CHECKIN_ENV` only. `config.isDev` (`src/lib/config.ts:30`) should be redefined off
`CHECKIN_ENV`, not `NODE_ENV`.

Because `CHECKIN_ENV` is a **server-side, non-`NEXT_PUBLIC_`** variable, it is not inlined into the
client bundle and the same image is safe in every environment — prod simply never sets it to `dev`.

> **Invariant (enforce in CI):** a production build/deploy must have `CHECKIN_ENV` unset or `prod`,
> and must never set `NEXT_PUBLIC_DEV_AUTH`. `local` must never appear in a deployed task definition.

---

## 4. Site-wide auth gate (principles 1 + 5)

When `CHECKIN_ENV=dev`, a **Next.js middleware** requires, for *every* route except the auth
endpoints and static assets, a valid session whose Google **hosted-domain (`hd`) claim is
`innovationtreehouse.org`** (verified server-side, with `email_verified`). Anonymous visitors and
bots are redirected to Google login and can read nothing else.

- This single gate delivers both "reachable from anywhere by org members" (#1) and "not
  world-readable" (#5) — they are the same rule stated from two directions.
- Prefer the Google `hd` claim over string-matching the email suffix (more robust for Workspace
  membership). Capture `hd` in the JWT/session callback (`src/lib/auth-options.ts`).
- In `prod` the middleware is inert (public surfaces remain public, exactly as today).
- In `local` the gate is relaxed so offline work doesn't require Google.

---

## 5. Impersonation: mint the session **as the persona**

### Decision
When an authenticated org member picks a persona, we **mint a real next-auth JWT for that persona
(e.g. `jane@example.com`)** — i.e., you *become* the persona. We do **not** keep your identity and
thread an "effective participant" through authz.

### Rationale
The alternative ("view as": keep your identity, swap an effective participant) forces **every authz
layer** — `withAuth`, the role-flag checks, the `isSelf` logic in `src/app/api/scan/route.ts`, every
"current participant" resolver — to become impersonation-aware. Miss one and impersonated behavior
silently diverges from real behavior, defeating the purpose. Minting the persona session keeps the
**entire authz surface untouched** (principle 2) and gives **maximum test fidelity**: you experience
exactly what the persona experiences, because nothing is special-cased.

### The cardinal rule (this is what keeps principle 4 without re-introducing awareness)
The minted JWT carries an **inert provenance claim**:

```
{ sub/email: "jane@example.com", ...normal persona claims...,
  impersonatedBy: "daniel@innovationtreehouse.org" }   // display + audit ONLY
```

**No authorization code path may ever read `impersonatedBy`.** Authz sees only `jane` (stays
unaware). Only the UI banner and the dev ledger read it. This is the single discipline that makes
the model safe and clean.

- **Banner (principle 4):** a persistent bar shows `🎭 Viewing as Jane Participant — you are
  daniel@innovationtreehouse.org`, derived from `impersonatedBy`.
- **Switch back:** "Return to me" re-mints a normal session for the email in `impersonatedBy`.

### The mint endpoint is the security boundary — fence it hard
This endpoint can forge any session, so it is gated on **all** of:
1. `CHECKIN_ENV === 'dev'` (or `local`) — never in prod.
2. The **caller's current real session** is a verified `@innovationtreehouse.org` member
   (checked server-side *in the route*, not via a build flag).
3. The target is a persona that exists in the dev database (fake data only).

Idiomatic implementation: a dev-only authenticated server action / route that verifies (1)+(2),
then drives a next-auth credential sign-in returning the persona user with the `impersonatedBy`
claim set. This replaces the current `Development Mock Auth` `CredentialsProvider` and the
`/api/auth/dev-personas` route (`src/app/api/auth/dev-personas/route.ts`).

---

## 6. Data isolation (principle 3) — structural, not a flag

- The dev instance's `DATABASE_URL` is a dedicated **`checkin_dev`** role whose Postgres grants are
  scoped to the **`checkin_dev` database only**. It has *no* privileges on the production `checkin`
  database (both live on the same Aurora cluster, separate databases).
- The production connection string is not present in the dev instance's secrets at all.
- Therefore even a forged persona session, a buggy macro, or the reset button **physically cannot**
  reach prod data. Isolation is enforced by the database, not by application logic.

---

## 7. The dev dashboard (the deliverable UI)

A slide-up panel, rendered **only** when `CHECKIN_ENV` is `dev`/`local`, for the logged-in org member:

```
┌─ app content ─────────────────────────────────────────────┐
│  🎭 Viewing as: Jane Participant        (you: daniel@ith.org)│  ← persistent banner (§5)
│   ...the real app, behaving exactly as Jane...             │
└────────────────────────────────────────────────────────────┘
╔════════════════ 🛠  DEV DASHBOARD  (slide-up) ═════════════╗
║  Persona:  [ Jane Participant ▾ ]  [ + new persona ]        ║
║  Macros:   [+ Program] [+ Family] [+ Event] [+ Check-ins]  ║
║  ───────────────────────────────────────────────────────  ║
║  Last activity: alice@ith.org reset 14 min ago             ║  ← ledger (principle 6)
║                                   [ 🔴 RESET DEV INSTANCE ] ║
╚════════════════════════════════════════════════════════════╝
```

- **Persona picker** → mint endpoint (§5). **Macros** → one-click scenario seeding. **🔴 Reset** →
  truncate + reseed `checkin_dev` to baseline, behind a ledger-surfacing confirm dialog. **Dev
  ledger** → a `checkin_dev` table recording last login / reset **by real identity** (principle 6).

The dashboard's build design (server-action security fence, the four macros, reset, and the
`DevLedger` model) is specified in `DEV_DASHBOARD_DESIGN.md`.

---

## 8. What gets removed / changed

| Item | Today | After |
|---|---|---|
| `NEXT_PUBLIC_DEV_AUTH` open mock-login | logs anyone in as anyone (non-prod) | **deleted** |
| `/api/auth/dev-personas` | lists `@example.com` personas (non-prod) | folded into the gated mint endpoint |
| Kiosk no-key fallback (`src/lib/auth.ts:31-35`) | cookieless request = kiosk when no key + `NODE_ENV!=prod` | **removed**; require a kiosk key always, or gate strictly on `CHECKIN_ENV=local` |
| `config.isDev` (`src/lib/config.ts:30`) | `NODE_ENV === 'development'` | `CHECKIN_ENV !== 'prod'` |
| Self-scan web block (`src/app/api/scan/route.ts`) | keyed on `NODE_ENV === 'production'` | key on `CHECKIN_ENV === 'prod'` |
| Env personality | `NODE_ENV` + `NEXT_PUBLIC_DEV_AUTH` + key-presence | single `CHECKIN_ENV` |

`NODE_ENV` stays `production` in all deployed environments.

---

## 9. Locked decisions

1. **One flag** — `CHECKIN_ENV` (`prod`/`dev`/`local`) is the only environment-personality switch.
2. **Site-wide gate via app middleware** (reuses existing Google OAuth + `hd` check) — not ALB OIDC.
3. **Impersonation = mint-as-persona** + an **inert `impersonatedBy` claim** that authz never reads.
4. **One shared dev instance** (not per-user sandboxes); the ledger + reset are the coordination model.
5. **Data isolation is structural** — `checkin_dev` role scoped to the `checkin_dev` DB only.

---

## 10. Likely files touched (checkin repo)

- `src/lib/config.ts` — define `CHECKIN_ENV`; redefine `isDev`.
- `src/lib/auth-options.ts` — capture `hd`/`email_verified`; replace mock provider with the gated
  persona-mint credential flow that sets `impersonatedBy`.
- `src/lib/auth.ts` — remove the `NODE_ENV` kiosk fallback.
- `middleware.ts` (new) — the site-wide org-login gate for `CHECKIN_ENV=dev`.
- `src/app/api/auth/dev-personas/route.ts` → replaced by a gated mint/persona endpoint.
- Dev dashboard component + banner (new); dev-only macro/reset/ledger server actions.
- `src/app/api/scan/route.ts` — swap `NODE_ENV` checks for `CHECKIN_ENV`.
- CI: assert prod build never sets `CHECKIN_ENV=dev|local` or `NEXT_PUBLIC_DEV_AUTH`.

## 11. Non-goals / open questions

- **Non-goal:** changing production auth, RBAC, or kiosk signature verification.
- **Open:** exact macro set for v1 (start with program/family/event/check-ins?).
- **Open:** should impersonation be limited to non-privileged personas, or is becoming a
  `sysadmin` persona desired for testing admin flows? (Likely yes — it's fake data.)
- **Infra note (for the deploy side, not this repo):** the dev task definition sets
  `CHECKIN_ENV=dev` and `DATABASE_URL`→`checkin_dev`; prod sets neither. Same image both places.

---

## 12. Local login: never call Google on a local-reachable path

**Invariant.** On `CHECKIN_ENV=local` there is no Google identity (creds are
dummy). Any UI control that calls `signIn("google", …)` on a path a *local*
user can reach is a bug — it redirects to real Google OAuth and dead-ends. Local
authenticates **only** through the offline persona-mint dev picker
(`DevLoginPicker` → `signIn("persona-mint", …)`, incl. its "New registrant (fresh
household)" button for a brand-new empty user). `dev` and `prod` use Google, only.

**The pattern for a logged-out CTA** (any "sign in to do X" button):

- Do **not** call `signIn("google")` directly from the feature page. Route to the
  sign-in screen with a return URL: `router.push("/signin?callbackUrl=<target>")`.
- `/signin` is the *one* place that branches by env: it renders `DevLoginPicker`
  (carrying the `callbackUrl`) when `useIsLocalInstance()`, and the Google button
  otherwise. Feature pages stay env-agnostic.
- `DevLoginPicker` takes a `callbackUrl` prop (default `"/"`) so the offline mint
  returns the user to where they started.

**Why this section exists.** Auth-first program registration shipped a CTA that
called `signIn("google")` unconditionally; it worked on dev/prod but broke every
local test of the new-user flow (no Google on a laptop). Fixed in
`fix(programs): route enroll CTA through /signin so LOCAL uses dev picker` (#863).
The single remaining sanctioned `signIn("google")` call site is the `/signin`
Google button itself (the dev/prod path). Adding another on a local-reachable
surface re-introduces this bug — grep for `signIn("google"` and keep that the
only hit.

