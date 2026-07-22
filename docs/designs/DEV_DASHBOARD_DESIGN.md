# Dev dashboard: seed macros, reset, and the coordination ledger

**Status: SHIPPED.** `src/components/DevDashboard.tsx` (slide-up panel) +
`src/components/DevImpersonationBar.tsx` (persona switcher / "Return to me") +
`src/lib/dev/{guard,ledger,seed-helpers}.ts`, the macro/reset server actions in
`src/lib/dev/actions.ts`, and the `DevLedger` model in `prisma/schema.prisma`.
Builds on `DEV_INSTANCE_DESIGN.md` (the `CHECKIN_ENV` model + mint-as-persona).

## 1. Scope

The dev instance already had impersonation (the bar) and the logged-out
`DevLoginPicker`. This adds the operator tooling: one-click scenario **macros**,
a **reset**, and a **ledger** so a shared instance shows who touched it last.

**Decided:** impersonation may target **any** persona including
`sysadmin`/`boardMember` — it is fake data and exercising admin flows is a
primary goal, so there is deliberately no persona-role restriction. **Deferred
(decided):** ad-hoc `+ new persona` creation — the switcher already covers every
seeded persona, so creation is additive and not needed for v1.

## 2. Security model (the load-bearing part)

Every macro, the reset, and every ledger write is a **dev-only Next.js server
action** that independently re-runs the mint fence **in the action body** —
never via a build flag, never trusting the client — through the shared
`assertDevActor()` (`src/lib/dev/guard.ts`). It is the *one* extracted definition
of the org-verification predicate (mirrors the `persona-mint` gate), so the bar,
the mint route, and these actions can never drift apart. It returns
`notFound()` (404, not 403) to keep the surface invisible.

Structural data isolation (`DEV_INSTANCE_DESIGN.md`) means even a bug here cannot
reach prod — this fence is defense-in-depth, not the primary control.

## 4. Macros

**One source of truth for entity creation.** The seed formerly lived in two
non-reusable places (`prisma/seed.ts`'s un-exported `main()` and an inline `pg`
script). The entity-creation steps are factored into exported, parameterized
helpers in `src/lib/dev/seed-helpers.ts` (`createFamily`/`createProgram`/… +
`seedBaseline`); both `prisma/seed.ts` and the macros call them, so there is no
copy-paste drift between the CLI seed and the dashboard. Macros are **additive**
(no truncation) so testers can stack scenarios — the reset is the only
destructive path.

## 5. Reset (truncate + reseed)

**Chosen over `prisma migrate reset`:** it runs from a live server action in
seconds, does not drop/rebuild the schema on a shared always-on instance, and
keeps the ledger. Schema drift is caught by the normal migration pipeline, not by
this button. The table list is queried from the catalog at runtime
(schema-drift-proof — new models are picked up automatically), truncating all
application tables **except** `_prisma_migrations` (schema stays migrated, so
reset is seconds not minutes) and **`DevLedger`** (coordination history must
survive a reset). The confirm dialog surfaces the most-recent ledger activity
before destroying data.

## 6. Ledger

A `checkin_dev` table (`DevLedger`) recording last login / impersonate / macro /
reset attributed to the **real** human (`impersonatedBy ?? email`) — never a
persona. It is the cross-tester memory, which is exactly why the reset excludes
it from truncation (§5). Written from the `persona-mint` flow (login vs.
impersonate, from `evaluateMint`) and from each server action; read by the
dashboard's last-activity line and the reset confirm dialog.

## Component & non-goals

`DevDashboard` renders only when `isDevInstance()` **and** signed in (the guard
the bar uses); server-only `config` never crosses to the client (it flows via
`EnvProvider`). Collapsed to a small FAB by default so it never obscures the app;
local `useState` only, no persistence; reuses the existing inline-style idiom, no
new design system.

**Non-goal:** any production behavior change — all of this is `notFound()` in
prod.

**Open (minor):** whether the ledger should capture *which routes* a tester hit
(richer activity) rather than last-action-per-human, and whether macros need a
count selector vs. fixed small fixtures. Both shipped with the simpler choice;
revisit only if they earn it.
