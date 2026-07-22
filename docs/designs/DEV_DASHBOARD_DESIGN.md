# Design: The Dev Dashboard

**Status:** Shipped — `DevDashboard.tsx`, `src/lib/dev/{seed-helpers,ledger,guard}.ts`, and the
`DevLedger` model exist (macros/reset landed in `src/lib/dev/actions.ts` rather than separate
`macros.ts`/`reset.ts`). This is the design record.
**Builds on:** `DEV_INSTANCE_DESIGN.md` — implements its **§7 (the dev dashboard)**. The single-flag
model (`CHECKIN_ENV`), the org middleware gate, and impersonation (mint-as-persona + inert
`impersonatedBy`) shipped earlier (commits `ea13ff4`, `e86a11e`).

---

## 1. Scope

What the dev-instance rework already has:

- `DevImpersonationBar` (`src/components/DevImpersonationBar.tsx`) — the persistent top bar: shows
  who you really are while impersonating, a **persona switcher**, and **Return to me**. All routed
  through the single `persona-mint` flow.
- `DevLoginPicker` — the logged-out quick-login grid.

What **this** design adds (the rest of §7):

1. A **slide-up dashboard panel** anchored bottom-right, rendered only when `CHECKIN_ENV` is
   `dev`/`local` for a signed-in org member.
2. **Macros** — four one-click scenario seeders: `+ Family`, `+ Program`, `+ Event`, `+ Check-ins`.
3. **🔴 Reset dev instance** — truncate + reseed `checkin_dev` to baseline, behind a confirm
   dialog that surfaces the ledger.
4. **Dev ledger** — a `checkin_dev` table recording the last login / impersonate / macro / reset by
   **real identity**, with timestamps (principle 6: no accidental clobbering).

**Deferred to a later slice** (decided): `+ new persona` creation. The switcher already covers all
seeded personas; ad-hoc persona creation is additive and not required for v1.

**Decided:** impersonation may target **any** persona including `sysadmin`/`boardMember` — it is
fake data and testing admin flows is a primary goal. No persona-role restriction.

---

## 2. Security model (the load-bearing part)

Every macro, the reset, and the ledger writes execute as **dev-only Next.js server actions**. Each
action independently enforces the same fence as the mint endpoint (`DEV_INSTANCE_DESIGN.md §5`),
**in the action body** — never via a build flag and never trusting the client:

```ts
async function assertDevActor() {
  if (config.isProd()) notFound();                       // dead in prod by construction
  if (config.checkinEnv() === 'dev') {                   // cloud dev is publicly reachable
    const session = await getServerSession(authOptions);
    const real = session?.user?.impersonatedBy ?? session?.user?.email;
    const claims = await getToken(...);                  // verify hd + email_verified
    if (!real || claims?.hd !== ORG_DOMAIN || !claims?.email_verified) notFound();
  }
  // local: relaxed (no Google identity), exactly as the mint flow already is.
  return real;  // the real human, for the ledger
}
```

- These actions only ever touch `checkin_dev`; data isolation is structural (`§6`), so even a bug
  here **cannot** reach prod data. This is defense-in-depth, not the primary control.
- Returning `notFound()` (404) rather than 403 keeps the surface invisible, matching how
  `dev-personas` already behaves.
- Reuse, don't reinvent: the org-verification predicate should be extracted from the existing
  `persona-mint` provider into a shared `assertDevActor()` helper so the bar, the mint route, and
  these actions share one definition.

---

## 3. Component architecture

```
RootLayout
 └─ DevImpersonationBar      (exists — top banner + switcher + return)
 └─ DevDashboard   (NEW)     (client; slide-up panel, bottom-right)
     ├─ MacroButtons         → server actions §4
     ├─ ResetButton          → confirm dialog (shows ledger) → server action §5
     └─ LedgerLine           → "last activity: alice reset 14 min ago"
```

- `DevDashboard` renders only when `useIsDevInstance()` **and** signed in (same guard the bar uses).
  Server-only `config` is never read client-side — it flows through the existing `EnvProvider`.
- Collapsed by default to a small `🛠` FAB so it never obscures the app; expands to the panel in §7
  of the parent design. State is local (`useState`), no persistence needed.
- Mounted once in `src/app/layout.tsx`, as a sibling of `DevImpersonationBar`, inside `AuthProvider`
  (needs `useSession`) and `EnvProvider`.
- Styling follows the existing inline-style / `glass-button` idiom already used by the bar and
  picker — no new design system.

---

## 4. Macros (dev-only server actions)

`src/lib/dev/macros.ts` (`'use server'`). Each macro: `assertDevActor()` → mutate `checkin_dev` →
write a ledger row → `revalidatePath('/')` (so the UI reflects new data) → return a short summary
string for a toast.

| Macro | Creates |
|---|---|
| `+ Family` | one `Household` + `HOUSEHOLD` membership; a lead adult + 1–2 members incl. a minor |
| `+ Program` | one `Program` with a `Fee`, plus 2 `ProgramParticipant`s |
| `+ Event` | one `Event` (optionally tied to the latest program) with a few `RSVP`s |
| `+ Check-ins` | recent `Visit` / `RawBadgeEvent` rows for existing participants, so attendance has data |

**Reuse the seed logic.** Today the seed lives in two non-reusable places: `prisma/seed.ts`
(`main()`, not exported) and the inline `pg` script in `scripts/full_reset_and_dev_init.sh`. This
design **factors the entity-creation steps into exported, parameterized helpers** in
`src/lib/dev/seed-helpers.ts` (`createFamily`, `createProgram`, `createEvent`, `createCheckins`,
`seedBaseline`). Both `prisma/seed.ts` and the macros then call these helpers — one source of truth,
no copy-paste drift. Each macro creates **additive** data (no truncation) so testers can stack
scenarios; the reset is the only destructive path.

Macros use realistic-but-obviously-fake names; uniqueness via a per-call counter/suffix derived from
existing row counts (no `Date.now()` needed in the action — it runs server-side at request time, so
`new Date()` is fine here; the workflow-script restriction does not apply to app code).

---

## 5. Reset (truncate + reseed)

`resetDevInstance()` server action in `src/lib/dev/reset.ts`:

1. `assertDevActor()` → `real`.
2. **Truncate** every application table in one statement, schema-drift-proof:
   ```sql
   TRUNCATE TABLE <all public tables except _prisma_migrations and "DevLedger">
     RESTART IDENTITY CASCADE;
   ```
   The table list is queried from `information_schema.tables` at runtime, so new models are picked up
   automatically and we never hand-maintain a list. `_prisma_migrations` is preserved (schema stays
   migrated — no re-migration, this is why truncate+reseed is seconds not minutes). **`DevLedger` is
   preserved** so the coordination history survives a reset.
3. `seedBaseline()` (the §4 helper) repopulates the standard personas + sample tools.
4. Write a `reset` ledger row attributed to `real`.
5. `revalidatePath('/', 'layout')`.

Why truncate+reseed over `prisma migrate reset` (decided): it runs from a live server action in
seconds, doesn't drop/rebuild the schema on a shared always-on instance, and keeps the ledger. Schema
drift is caught by the normal migration pipeline, not by the reset button.

**Confirm dialog** surfaces the ledger before destroying data (principle 6):
> `alice@ith.org` was testing 14 min ago. Reset anyway?

---

## 6. Dev ledger

New Prisma model (in `checkin_dev` like everything else):

```prisma
model DevLedger {
  id        Int      @id @default(autoincrement())
  action    String   // 'login' | 'impersonate' | 'reset' | 'macro:family' | 'macro:program' | ...
  realActor String   // the real human (from impersonatedBy ?? email); never a persona
  detail    String?  // e.g. persona email impersonated, or macro summary
  createdAt DateTime @default(now())
  @@index([createdAt])
}
```

Written from two places:

- **Login / impersonate** — in the `persona-mint` flow (`src/lib/auth-options.ts`), after a
  successful mint, record `login` (plain) or `impersonate` (with the target persona in `detail`),
  attributed to the **real** identity (`evaluateMint` already computes `impersonatedBy`).
- **Macros / reset** — in each server action (§4, §5).

Read by:

- The dashboard's **last-activity line** (most-recent row, relative time).
- The **reset confirm dialog** (most-recent non-`login` row).

Exposed via a tiny gated reader (server action or `GET /api/dev/ledger`, `assertDevActor`-fenced).
Ledger survives resets (excluded from truncate, §5) — it *is* the cross-tester memory.

---

## 7. Files touched

New:
- `src/components/DevDashboard.tsx` — the slide-up panel (FAB + macros + reset + ledger line).
- `src/lib/dev/seed-helpers.ts` — `createFamily/Program/Event/Checkins`, `seedBaseline` (extracted).
- `src/lib/dev/macros.ts` — the four macro server actions.
- `src/lib/dev/reset.ts` — `resetDevInstance()`.
- `src/lib/dev/ledger.ts` — `recordLedger()` + `recentActivity()`.
- `src/lib/dev/guard.ts` — `assertDevActor()` (extracted from the mint provider; shared).
- `prisma/migrations/*` — add `DevLedger`.

Changed:
- `src/app/layout.tsx` — mount `DevDashboard`.
- `prisma/seed.ts` — call the new `seed-helpers` (one source of truth).
- `src/lib/auth-options.ts` — call `recordLedger()` on mint; use shared `assertDevActor` predicate.

---

## 8. Build order

1. `DevLedger` migration + `ledger.ts` + `guard.ts` (foundations; no UI).
2. Extract `seed-helpers.ts`; point `prisma/seed.ts` at it (refactor, behavior-preserving — verify
   seed still works).
3. `reset.ts` + `macros.ts` server actions (testable without UI).
4. `DevDashboard.tsx`; mount in layout.
5. Hook `recordLedger()` into the mint flow.
6. Tests: `guard` (prod/dev/local × org/non-org), `evaluateMint` already covered; macro/reset
   integration tests against a test DB.

---

## 9. Non-goals / open questions

- **Non-goal:** any production behavior change. All of this is `notFound()` in prod.
- **Non-goal (v1):** `+ new persona` creation — deferred (decided).
- **Open:** should the ledger also capture *which routes* a tester hit (richer activity), or is
  last-action-per-human enough? Start with last-action.
- **Open:** macro volume — fixed small fixtures vs. a count selector (e.g. "+ 10 check-ins"). Start
  fixed; add counts only if needed.
