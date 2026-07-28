# Dev instance & impersonation: one env flag, mint-as-persona

**Status: SHIPPED.** Env personality is the server-only `CHECKIN_ENV`
(`prod`/`dev`/`local`) read through `src/lib/config.ts` (`checkinEnv`, `isProd`,
`isDevInstance`, `isLocal`, `devToolsActive`). The cloud-dev site-wide gate is
`src/middleware.ts`; impersonation is the `persona-mint` provider in
`src/lib/auth-options.ts` + `src/lib/impersonation.ts` (`evaluateMint`); the
shared server-action fence is `src/lib/dev/guard.ts` (`assertDevActor`). The
old `NEXT_PUBLIC_DEV_AUTH` mock-login and the `NODE_ENV` kiosk fallback are
gone. **The dashboard UI deliverable (§7) has its own record: `DEV_DASHBOARD_DESIGN.md`.**
*(The §4/§5/§7 anchors below are kept — source files cite them by number.)*

## The problem this solved

Non-prod auth personality was a cross-product of `NODE_ENV` ×
`NEXT_PUBLIC_DEV_AUTH` × kiosk-key-presence, and two of those flags *weakened*
auth off-prod (mock-login as anyone; cookieless-request-is-kiosk). The goal was
a single switch that is dead in prod by construction, gated on verified org
identity, and structurally unable to touch prod data — a net security *gain*
under `CONSTITUTION.md`, changing no production auth path.

## Decisions and constraints (code-independent)

**One flag, `CHECKIN_ENV`, server-only.** It is deliberately **not**
`NEXT_PUBLIC_` so it is never inlined into the client bundle — the same image
ships everywhere and prod simply never sets it. `readCheckinEnv` **fails safe to
`prod`** for any unset/blank/unrecognized value; that is the load-bearing safety
property, so every dev-tool gate is derived from it, never from a hand-rolled
`NODE_ENV` check.

**`NODE_ENV` stays `production` in every *deployed* env — including cloud-dev.**
The standalone `server.js` is a production build artifact. This is a repeated
footgun: pairing a dev-tool gate with `NODE_ENV !== 'production'` 404s the tool
on the very (prod-image) instance it exists for. `devToolsActive()` /
`isDevInstance()` rest on `CHECKIN_ENV` alone for exactly this reason.

**Staging (`stg`) is intentionally NOT in the `CheckinEnv` union.** ops-stg is
detected by a separate raw-`process.env.CHECKIN_ENV` predicate (`isStagingEnv`),
because adding `'staging'` to the union would flip every `!== 'prod'` mock gate
ON in staging — the opposite of what a prod-data-copy env wants. See the
ops-stg design.

**Site-wide gate is app middleware, not ALB OIDC (§4).** On `CHECKIN_ENV=dev` every
page route requires a session whose Google **hosted-domain (`hd`)** claim is
`ORG_DOMAIN` with `emailVerified` — one rule that delivers both "reachable by
any org member" and "not world-readable". Chosen over ALB OIDC so the app owns
its identity and the same OAuth already in place is reused. Inert in `prod`;
relaxed in `local` (offline work needs no Google).

**Impersonation = mint the session AS the persona (§5).** Picking a persona mints a
real JWT for that persona — you *become* them; authz sees only the persona and
stays impersonation-unaware. *Rejected: "view as"* (keep your identity, thread an
effective-participant through authz) — it forces **every** authz layer to become
impersonation-aware, and a single missed one silently diverges impersonated from
real behavior, defeating the purpose. Mint-as-persona keeps the entire authz
surface untouched and gives exact test fidelity.

**The cardinal rule — no authz path may read `impersonatedBy`.** The minted JWT
carries an inert `impersonatedBy` claim for **display + ledger only**. This one
discipline is what keeps "who are you really" answerable without re-introducing
impersonation-awareness. The middleware in particular must never read it.

**The mint endpoint is the security boundary — fenced in-route, not by a build
flag.** It can forge any session, so it independently checks: `CHECKIN_ENV` is
`dev`/`local`; the caller's *current real* session is a verified org member; the
target is a seeded `@example.com` persona (never a real user, even one present in
the dev DB). Returns `notFound()` (404), not 403, to keep the surface invisible.
The seeded-persona-only limit is mirrored in the persona lister
(`/api/auth/dev-personas`) and in `evaluateMint`.

**Data isolation is structural, not a flag.** The dev instance's `DATABASE_URL`
is a `checkin_dev` role scoped to the `checkin_dev` database; the prod
connection string is absent from dev secrets. A forged session, a buggy macro,
or the reset button therefore *physically* cannot reach prod data — defense the
DB enforces, not app logic.

**One shared dev instance, not per-user sandboxes.** The ledger + reset (see
`DEV_DASHBOARD_DESIGN.md`) are the coordination model.

**Local has no Google identity — this is a standing footgun for logged-out
CTAs.** On `CHECKIN_ENV=local` credentials are dummy; the only working sign-in is
`persona-mint` (via `DevLoginPicker`). A bare `signIn("google")` on a
local-reachable CTA silently dead-ends every local test of that flow (the #863
bug). The sanctioned pattern is to route logged-out CTAs to `/signin`, the one
screen that branches on `useIsLocalInstance()` (persona picker vs. Google
button). **Limitation to watch:** the codebase has *not* fully converged on this
— the home page shows the Google button and `DevLoginPicker` together, and the
`AppFrame` header's "Sign In To Dashboard" button is still a bare
`signIn("google")` with no local escape beside it. So adding a new logged-out CTA
means consciously routing it through `/signin`; there is no lint/grep invariant
guaranteeing a persona-mint path on every surface.

## Non-goals

Production authentication, RBAC, and kiosk signature verification are unchanged
by design.
