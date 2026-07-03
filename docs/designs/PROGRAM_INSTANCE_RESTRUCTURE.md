# Design Proposal: 3-Tier Program → Instance → Event Restructure

**Status:** Proposal (no code changes)
**Supersedes:** Audit item **P2-3** (naming confusion around "session"/"program"/"event")
**Scope:** `checkin-app` (schema + security + UI + data migration)

---

## 0. The core thesis

P2-3 was filed as a *naming* problem. It is actually a *missing structural layer*.

Today `Program` does two jobs at once:

1. It is a **catalog definition** ("Woodworking 101") — a reusable thing with a name, an age range, a membership policy.
2. It is a **concrete offering** ("Fall 2026 Woodworking") — a thing with dates, a roster, a lead mentor, fees, and a capacity you can fill.

Because those two jobs share one row, the URL layer had to invent a fake middle word: `/program-ops/sessions/*` today creates **`Event`** rows (the "New Event form" literally lives at `sessions/new/page.tsx`). "Session" is a placeholder for a tier that does not exist in the schema. That mislabel **is** P2-3.

The fix is to split the tier apart:

```
Program        definition / template   "Woodworking 101" (catalog entry)
  └─ ProgramInstance   offering / run   "Fall 2026 Woodworking"  ← NEW
       └─ Event        occurrence       "Woodworking, Tue Sep 8, 4pm"  (today's Event row)
```

Locked names (product owner): model **`ProgramInstance`** (never bare `instance`/`instanceId` in the *domain* sense — but the FK column **is** `instanceId`, which is fine as a column name because it sits on a row whose model context disambiguates it), UI copy **"Instance"**, leaf stays **`Event`**. `Session` is off-limits (NextAuth owns `model Session` ~840).

---

## 1. Current structure map

### `model Program` (schema.prisma ~586–629)

| Field | Type | Nature |
|---|---|---|
| `id` | Int PK | — |
| `name` | String | definition |
| `leadMentorId` / `leadMentor` | Int? → Person `"ProgramLeadMentor"` | **offering** |
| `startAt` | DateTime? | **offering** |
| `endAt` | DateTime? | **offering** |
| `phase` | ProgramPhase @default(PLANNING) | **offering** (lifecycle of a run) |
| `enrollmentStatus` | EnrollmentStatus @default(CLOSED) | **offering** |
| `orgMemberOnly` | Boolean | definition (policy) |
| `minAge` / `maxAge` | Int? | definition (policy) |
| `maxParticipants` | Int? | **offering** (capacity) |
| `leadMentorNotificationSettings` | Json? | **offering** (follows lead mentor) |
| `orgMemberPriceCents` / `nonOrgMemberPriceCents` | Int? | **offering** (pricing) |
| `shopifyProductId` | String? | **offering** |
| `shopifyOrgMemberVariantId` / `shopifyNonOrgMemberVariantId` | String? | **offering** |

**Child relations off Program:**

- `volunteers` → `ProgramVolunteer[]` (PK `[programId, personId]`, `isCore` flag)
- `participants` → `ProgramParticipant[]` (PK `[programId, personId]`, roster: `status`, `isPaymentPlanRequested`, `pendingSince`)
- `fees` → `Fee[]` (`programId`, `name`, prices; `Fee` → `FeePayment[]`)
- `events` → `Event[]`

**Person side** (schema ~115–117): `programVolunteers`, `programParticipants`, `programsLed` (`Program[] @relation("ProgramLeadMentor")`).

### `model Event` (schema.prisma ~702–729)

`id`, `programId Int?` (~706, nullable — a program-less event is admin/board-only), `name`, `startAt`, `endAt`, `description`, `attendanceConfirmedAt`, `attendanceConfirmedById`/`By` (`"EventAttendanceConfirmer"`), `postEventEmailSent`, `recurringGroupId String?` (~724). Relations: `program Program?`, `rsvps RSVP[]`, `visits Visit[]`.

`recurringGroupId` is a `crypto.randomUUID()` stamped by `POST /api/events` (`events/route.ts` ~87) across every Event generated from one recurrence form submission. **Attendance lives here and does not move**: `RSVP` (PK `[eventId, personId]`), `Visit`, and `Event.attendanceConfirmedAt/By`.

### Everything FK'd to `Program` (grep `programId` — 74 files)

- **Schema FKs:** `ProgramVolunteer.programId`, `ProgramParticipant.programId`, `Fee.programId`, `Event.programId`.
- **Security config:** `access-resolvers.ts` (`buildCallerContext` queries `program.findMany({where:{leadMentorId}})` + `programVolunteer` + `event.findMany({where:{programId}})`), `scopeBindings.ts` (Program/ProgramParticipant/ProgramVolunteer/Event/RSVP bindings), `scopes.ts` (`'programsLed'` scope-ctx key), `generated/classifications.ts` (`programsLed: {model:'Program'}`), `registry.ts` (`returns:` bags + `program-lead-mentor`/`program-core-volunteer` authorize).
- **Auth claim:** `auth-options.ts` (~253/294 select, ~323 assign), `authClaims.ts`, `next-auth.d.ts`, `program-ops/layout.tsx`.
- **Routes/UI/lib:** all of `api/programs/[id]/*`, `api/events/*`, `api/nav/todo-counts`, `api/facility/trends`, `api/webhooks/shopify`, `api/finance-ops/payment-plans`, `api/cron/*`, `lib/program/capacity.ts` (`SELECT ... FROM "Program" ... FOR UPDATE`), `lib/attendanceTransitions.ts`, `lib/postEventEmails.ts`, plus the `program-ops` + `finance-ops` + `facility-ops` pages.

---

## 2. The child-placement split (the central design question)

> You do not enroll in a *definition* — you enroll in an *offering*. So most of Program's current children belong on `ProgramInstance`.

| Item (today on `Program`) | Placement | Justification |
|---|---|---|
| `ProgramParticipant` (roster) | **→ ProgramInstance** | You enroll in a run, not a template. Two runs of "Woodworking 101" have disjoint rosters. |
| `ProgramVolunteer` | **→ ProgramInstance** | Volunteers staff a specific run; `isCore` core-vol status is per-offering (and drives per-offering security scope). |
| `Fee` / `FeePayment` | **→ ProgramInstance** | Fees are charged per run; a payment is against the offering the person joined. |
| `leadMentorId` / `leadMentor` | **→ ProgramInstance** | Different terms have different leads. This move is what re-tiers the whole security claim (§3). |
| `maxParticipants` (capacity) | **→ ProgramInstance** | Capacity is a property of one run's room/session, not the catalog entry. `capacity.ts`'s `FOR UPDATE` lock re-targets the instance row. |
| `startAt` / `endAt` | **→ ProgramInstance** | Run dates. The definition is dateless. |
| `phase` (`ProgramPhase`) | **→ ProgramInstance** | PLANNING→…→done is a run's lifecycle. |
| `enrollmentStatus` (`EnrollmentStatus`) | **→ ProgramInstance** | A run opens/closes enrollment; the definition never does. |
| `orgMemberPriceCents` / `nonOrgMemberPriceCents` | **→ ProgramInstance** | Price varies per run (early-bird, inflation). Moves with `Fee`. |
| `shopifyProductId` / `shopify*VariantId` | **→ ProgramInstance** | Each run is a separately-sold Shopify product/variant; the `webhooks/shopify` order maps a purchase to a concrete offering. |
| `leadMentorNotificationSettings` | **→ ProgramInstance** | Follows the (now per-instance) lead mentor. |
| `orgMemberPriceCents` / `nonOrgMemberPriceCents` | **stays on Program** | **Board-set** enrollment price — an authority decision that governs the definition, not something a lead mentor re-sets per run. |
| `shopifyProductId` / `shopify*VariantId` | **→ ProgramInstance** (see note) | The *price number* is board-set on the definition, but the Shopify sellable an order maps back to must identify the concrete run, or `webhooks/shopify` can't resolve a purchase to an offering. Instance owns the variant ids; each variant's *price* is synced from the parent Program's board-set cents. |
| `name` | **stays on Program** | The definition name ("Woodworking 101"). *See note ↓ — the instance needs its own label too.* |
| `minAge` / `maxAge` | **Program default, instance may NARROW** | Age band is a definition policy, but a run may restrict it tighter (never looser). Instance gets nullable `minAge`/`maxAge` overrides; effective = the **tighter** bound. See §3a. |
| `orgMemberOnly` | **Program default, instance may NARROW** | If the definition is open (`false`), a run may set it member-only (`true`); a member-only definition can never be loosened by a run. Instance gets nullable `orgMemberOnly` override; effective = `program OR instance`. See §3a. |

**Instance needs a label.** `Program.name` = "Woodworking 101"; the instance needs `ProgramInstance.name` (or `termLabel`) = "Fall 2026" so UIs can render "Woodworking 101 — Fall 2026". Backfill sets it from the parent name initially (see §4).

**Net:** the definition owns `name`, the board-set prices, and the *baseline* policy (`minAge`/`maxAge`/`orgMemberOnly`). The instance may carry *narrowing overrides* of that policy (§3a) but never widen it. Everything else operational moves fully down. A `Program` row is cheap to create (a catalog stub with policy + price) and the run-specific weight lives on the instance.

**Price/Shopify split (DECIDED):** enrollment price lives on the definition (board authority); the Shopify *variant ids* live on the instance so orders map to a run. One price per definition applies to every run. Per-run pricing (early-bird) is explicitly *someday-maybe* — Shopify discount codes cover it with no schema change — so there is no instance price column. (§9.4)

---

## 3. New schema

### `model ProgramInstance` (new)

```prisma
model ProgramInstance {
  id                             Int              @id @default(autoincrement())
  programId                      Int              // FK → Program (the definition)
  program                        Program          @relation(fields: [programId], references: [id])
  name                           String           // run label, e.g. "Fall 2026"
  leadMentorId                   Int?
  leadMentor                     Person?          @relation("InstanceLeadMentor", fields: [leadMentorId], references: [id])
  startAt                        DateTime?
  endAt                          DateTime?
  phase                          ProgramPhase     @default(PLANNING)
  enrollmentStatus               EnrollmentStatus @default(CLOSED)
  maxParticipants                Int?
  leadMentorNotificationSettings Json?
  // Narrowing overrides (§3a). NULL = inherit the definition's value.
  // Non-null must be STRICTLY TIGHTER than the parent — enforced at write time.
  minAge                         Int?
  maxAge                         Int?
  orgMemberOnly                  Boolean?
  // Board-set enrollment price stays on Program; the instance holds only the
  // Shopify sellable ids (variant price synced from the parent's board-set cents).
  shopifyProductId               String?
  shopifyOrgMemberVariantId      String?
  shopifyNonOrgMemberVariantId   String?

  volunteers   ProgramVolunteer[]
  participants ProgramParticipant[]
  fees         Fee[]
  events       Event[]
}
```

- Enums `ProgramPhase` / `EnrollmentStatus` are reused unchanged (they already describe an offering's lifecycle).
- `Person."InstanceLeadMentor"` back-relation replaces `"ProgramLeadMentor"`; `Person.instancesLed ProgramInstance[]` replaces `programsLed`.
- `ProgramParticipant`, `ProgramVolunteer`, `Fee` gain `instanceId` (was `programId`); their composite PKs become `[instanceId, personId]`.

### `Program` after the move (definition only)

```prisma
model Program {
  id                     Int      @id @default(autoincrement())
  name                   String
  orgMemberOnly          Boolean  @default(false)
  minAge                 Int?
  maxAge                 Int?
  orgMemberPriceCents    Int?     // board-set
  nonOrgMemberPriceCents Int?     // board-set
  instances              ProgramInstance[]
}
```

### `Event`'s new FK

```prisma
model Event {
  ...
  instanceId  Int?              // was programId; nullable (program-less events stay admin/board-only)
  instance    ProgramInstance?  @relation(fields: [instanceId], references: [id])
  // reaches the definition via event.instance.program — NO denormalized programId
  ...
}
```

**Decision: do NOT keep a denormalized `Event.programId`.** Reasons:

1. The security bindings key `Event` on a single row field (`Event.their_program_participants: {field:'programId', inCtx:[…]}`). That re-keys cleanly to `{field:'instanceId', inCtx:['instancesLed','instancesCoreVolIn']}` — one field swap, symmetric with today. A denormalized `programId` would need a *second* binding and could **drift** (Event pointing at instance A but stamped programId B) — a silent authz-scope bug, exactly the class this repo keeps getting burned by.
2. The event→program reads that remain (e.g. cron post-event emails needing the program name) go through `event.instance.program` — one extra join, not a hot path.

Trade-off accepted: `buildCallerContext` and any "events in my program" query gains one hop (`Event.instanceId ∈ instancesLed`). Cheap; the set is already materialized per-request.

### 3a. Policy narrowing (age band + member-only)

`minAge`, `maxAge`, `orgMemberOnly` exist on **both** models: the definition sets the baseline, the instance holds nullable overrides. **Invariant: an instance may only make policy STRICTER, never looser.** The effective value a run enforces:

```
effectiveMinAge        = max(program.minAge ?? -∞, instance.minAge ?? -∞)   // higher floor wins
effectiveMaxAge        = min(program.maxAge ?? +∞, instance.maxAge ?? +∞)   // lower ceiling wins
effectiveOrgMemberOnly = program.orgMemberOnly || (instance.orgMemberOnly ?? false)  // OR: once true, stays true
```

- `NULL` override = inherit the definition's value.
- **Write-time guard** (instance PATCH route, mirrored in a DB check where practical): reject an override that would *widen* — `instance.minAge < program.minAge`, `instance.maxAge > program.maxAge`, or `instance.orgMemberOnly === false` while `program.orgMemberOnly === true`. Fail closed with a 400; never silently clamp (a clamp hides operator error).
- **One resolver, not scattered `min`/`max`.** Put `effectiveEligibility(program, instance)` in `lib/program/` and route every eligibility check through it. Today age/member gating reads `program.minAge`/`maxAge`/`orgMemberOnly` directly in `programs/[id]/enroll.ts` and the `programAgeBounds` / `programAgeStartDate` integration tests — enrollment is now per-instance, so those read the **effective** value, not the raw definition field. Grep every `.minAge`/`.maxAge`/`.orgMemberOnly` read and re-point it. (A `[[tsc-misses-prisma-rename-escapes]]`-class hazard: the field still exists on `Program`, so a missed call site type-checks green and silently enforces the un-narrowed band.)

Justification for storing on both (vs deriving): the run operator sets and sees the narrowed band as data (it drives the public listing's displayed age range and the enrollment form), and the invariant needs a concrete value to validate against. Derive-on-read can't be edited.

---

## 4. Migration + seed + mocks (no data backfill — pre-launch)

**No production rows exist yet.** There is nothing to split 1:1, no `programId → instanceId` backfill map, no reparent-existing-Events step. The migration files are pure schema DDL; the real work is updating the **seed** and the **test fixtures** so they build the 3-tier shape.

### 4a. Schema migrations (DDL only)

| Step | Operation |
|---|---|
| **M0** | Create `ProgramInstance` table (additive). Add nullable `Event.instanceId` + FK. |
| **M1** | Add `instanceId` to `ProgramParticipant`/`ProgramVolunteer`/`Fee`; add the moved columns (`leadMentorId`, dates, `phase`, `enrollmentStatus`, `maxParticipants`, `leadMentorNotificationSettings`, `shopify*`) + the nullable narrowing overrides (`minAge`/`maxAge`/`orgMemberOnly`) to `ProgramInstance`. |
| **M2** | Repoint the `Fee`/`ProgramParticipant`/`ProgramVolunteer` FK+PK from `programId` to `instanceId` via **RENAME** (`ALTER TABLE … RENAME COLUMN`), not drop+add — preserves the `[programId, personId]` → `[instanceId, personId]` composite-PK index and the capacity `FOR UPDATE` raw-SQL target. Drop `Event.programId` once reads cut over (P5). |
| **M3** | Drop the vacated `Program` columns (P5, its own migration). **Prices stay on `Program`.** |

No data-migration SQL between these — an empty table needs no `UPDATE`. (If a shared staging DB has throwaway rows, `prisma migrate reset` + re-seed is simpler than backfilling them.)

### 4b. Seed (`prisma/seed.ts` → `seed-helpers.ts`)

The seed becomes the **reference example** of the 3-tier model — get it right and it documents the shape.

- **`seedBaseline` sample** (`seed-helpers.ts` ~211, "Woodworking 101"): split into a `Program` definition (`name`, `minAge`, `orgMemberOnly`, prices) **+ one `ProgramInstance`** offering (`programId`, run `name` e.g. "Fall 2026", `leadMentorId`, dates, `phase`, `enrollmentStatus`, `maxParticipants`). This is the canonical "one definition, one run" example.
- **`createProgram` macro** (~271): today builds Program + `Fee`(`programId`) + `ProgramParticipant`(`programId`). Now builds Program(def) → ProgramInstance(offering) → `Fee`/`ProgramParticipant` on **`instanceId`**.
- **`createEvent` macro** (~301): `latestProgram` → **`latestInstance`** (`prisma.programInstance.findFirst({orderBy:{id:'desc'}})`); `event.create({ instanceId })` instead of `programId`.
- Check `prisma/seed_20_users.ts` for any program/event construction and re-tier likewise.
- Seed is the fastest smoke test: after the change, `npx tsx prisma/seed.ts` on a throwaway PG must run clean and produce a def+instance+events chain the app renders.

### 4c. Test fixtures / mocks (13 non-integration files — tsc-BLIND)

These build response-shaped mock objects with `{programId, leadMentorId, …}` string keys that feed component/route unit tests. Jest mock literals are loosely typed, so a stale `programId` key **compiles green and fails at runtime** (`[[mock-tests-tsc-blind-renames]]`, `[[test-dirs-two-roots]]`). Hand-update each to the instance shape:

```
src/app/my-activities/programs/__tests__/page.test.tsx
src/app/programs/__tests__/page.test.tsx
src/app/programs/[id]/__tests__/page.test.tsx
src/app/api/programs/__tests__/programsCreateDate.test.ts
src/app/api/events/[id]/rsvp/__tests__/rsvpHouseholdLead.test.ts
src/app/finance-ops/payment-plan/__tests__/page.test.tsx
src/app/program-ops/programs/[id]/__tests__/page.test.tsx
src/app/program-ops/sessions/[id]/__tests__/page.test.tsx   (also renames sessions→instances, P4)
src/app/program-ops/new/__tests__/page.test.tsx
src/security/__tests__/payment-plans-strip.test.ts          (CallerContext: programsLed→instancesLed)
src/security/__tests__/rsvp-program-scope.test.ts           (ctx set + Event.programId→instanceId)
src/lib/__tests__/postEventEmails.test.ts
src/lib/__tests__/postEventEmails.bench.test.ts
```

Grep **all three test roots** (`src/**/__tests__`, `tests/`, `__tests__/`) for `programId`/`leadMentorId`/`programsLed` on the renamed models — the list above is the non-integration set; integration fixtures re-tier alongside their routes per-phase. Do NOT scope the fixture sweep to a subdir (`[[sliced-rename-cross-dir-consumers]]`); grep repo-wide with `grep -r`, not `git grep -- 'dir/*'` (`[[git-grep-pathspec-no-recurse]]`).

---

## 5. Security ripple map

This is the large blast radius. All of it is **tsc-blind on Prisma where-clauses** (recursive `WhereInput` widening) — integration tests `--runInBand` are the real net.

### 5a. The `programsLed` → `instancesLed` claim swap

`leadMentor` moving to Instance re-tiers the entire claim chain:

| File | Today | After |
|---|---|---|
| `auth-options.ts` ~253/294 | `programsLed: { select: { id: true } }` on the Person include | `instancesLed: { select: { id: true } }` |
| `auth-options.ts` ~323 | `session.user.programsLed = token.programsLed` | `…instancesLed = token.instancesLed` |
| `authClaims.ts` | `ClaimSourceParticipant.programsLed`, `token.programsLed = p.programsLed?.map(...)` | `instancesLed` |
| `next-auth.d.ts` ~21/62 | `programsLed?: number[]` (Session + JWT) | `instancesLed?: number[]` |
| `program-ops/layout.tsx` ~34 | `user?.programsLed?.includes(editProgramId)` | row gate keys off the **instance** id the edit URL now carries (see §6 URL note) → `instancesLed.includes(editInstanceId)` |

### 5b. `buildCallerContext` (access-resolvers.ts ~61–103)

| Context field | Today | After |
|---|---|---|
| `programsLed` | `program.findMany({where:{leadMentorId: user.id}})` | `programInstance.findMany({where:{leadMentorId: user.id}})` → **`instancesLed`** |
| `programsCoreVolIn` | `programVolunteer.findMany({where:{personId,isCore}}).programId` | same query, field now `instanceId` → **`instancesCoreVolIn`** |
| `participantIdsInScopePrograms` | `program.participants` | `instance.participants` (rename optional; contents identical) |
| `eventIdsInScopePrograms` | `event.findMany({where:{programId: {in: scopePrograms}}})` | `event.findMany({where:{instanceId: {in: scopeInstances}}})` |
| `householdIdsInScopePrograms` | derived from participant ids | unchanged logic, upstream source re-tiered |

### 5c. `scopeBindings.ts` (CODEOWNERS-gated)

Re-tier the bindings — keep the **scope names** (`their_program_participants`, `their_program_households`) stable to minimize churn; only the `field`/`inCtx` change:

| Binding | Today | After |
|---|---|---|
| `Program` entry | `their_program_participants: {field:'id', inCtx:['programsLed','programsCoreVolIn']}` | becomes a **`ProgramInstance`** entry keyed the same way on `instancesLed`/`instancesCoreVolIn` |
| `ProgramParticipant` | `{field:'programId', inCtx:['programsLed','programsCoreVolIn']}` | `{field:'instanceId', inCtx:['instancesLed','instancesCoreVolIn']}` |
| `ProgramVolunteer` | `{field:'programId', …}` | `{field:'instanceId', …}` |
| `Event` | `{field:'programId', inCtx:[…programs…]}` | `{field:'instanceId', inCtx:[…instances…]}` |
| `RSVP` | `{field:'eventId', inCtx:'eventIdsInScopePrograms'}` | **unchanged field**, ctx set contents re-tiered upstream |
| `FeePayment` | keyed on `personId` ∈ `participantIdsInScopePrograms` | unchanged |

`scopes.ts` union: `'programsLed'` → `'instancesLed'` (+ `'programsCoreVolIn'` → `'instancesCoreVolIn'`). `generated/classifications.ts`: `programsLed: {model:'Program'}` → `instancesLed: {model:'ProgramInstance'}` (regenerated, not hand-edited). The `scopeBindingsEquivalence.test.ts` oracle and every `ctx({programsLed: new Set()})` in `src/security/__tests__/*` must swap key names — these are **tsc-visible** for the ctx type but the *string* scope names in test fixtures are not; grep both.

### 5d. The event→program authorize hop → event→instance→program

| Site | Today | After |
|---|---|---|
| `events/[id]/route.ts` inline gate (~31, ~58, ~77, ~84, ~217) | `event.program.leadMentorId`, `event.program.volunteers`, `programParticipant.findFirst({where:{programId: event.programId}})` | `event.instance.leadMentorId`, `event.instance.volunteers`, `where:{instanceId: event.instanceId}` |
| `programs/[id]/route.ts` roster gate + GAP-1 PATCH | reads/writes `program.leadMentorId`, `participants`, `maxParticipants`, prices, phase, `enrollmentStatus` | most of these move to the **instance** — route splits into a definition route (name + **baseline** age/memberOnly + **board prices**) and an instance route (lead/capacity/dates/phase/enrollment/shopify + **narrowing** age/memberOnly overrides, §3a). See §6. |
| `registry.ts` `returns:` bags | include `'Program'` for the roster/event bags | add `'ProgramInstance'`; keep `'Program'` where definition metadata (name) is still returned |
| `resolveAccess` `program-lead-mentor` / `program-core-volunteer` (~216/221) | `callerContext.programsLed.has(id)` where `id = params.id` (a program id) | keys off the **instance** id the route param now carries → `instancesLed.has(id)` |

**Atomicity requirement:** the claim swap (5a) and its consumers (5b–5d) must land in **one** phase (P3), because a session minting `instancesLed` while `layout.tsx`/`buildCallerContext` still read `programsLed` = every lead mentor locked out mid-deploy. See P3 below.

---

## 6. How P2-3 resolves + the public surfaces

**P2-3 output:** the fake "session" word disappears. `/program-ops/sessions/*` (which today CRUDs `Event` rows via the "New Event form") becomes **`/program-ops/instances/*`** — real `ProgramInstance` CRUD — and Events are created *nested under an instance*. The three tiers finally have three names that match the schema:

- `Program` → "Program" (catalog definition)
- `ProgramInstance` → "Instance" (offering/run)
- `Event` → "Event" (occurrence)

**Public surfaces — DECIDED: both list instances.**

- **`/programs` (public directory, `programs/page.tsx`)** — lists **`ProgramInstance` rows with open `enrollmentStatus`** ("Fall 2026 Woodworking, enrolling now"), not definitions. Rationale: you enroll in offerings; enrollment/dates/capacity all live on the instance, and a definition with no open run is nothing to register for. Display each instance's `name` alongside its parent definition's `name` ("Woodworking 101 — Fall 2026"). A pure definition-catalog view, if ever wanted, is a separate staff/admin surface — not this page. This changes the public IA (the directory is now a *schedule*).
- **`/my-activities/programs` (`my-activities/programs/page.tsx`)** — "programs I'm enrolled in." Enrollment (`ProgramParticipant`) moves to the instance, so this lists **instances** the person is enrolled in (rendered "Woodworking 101 — Fall 2026"). Follows the roster FK down.

---

## 7. Phased plan (each phase independently shippable + tsc-green)

Modeled on the Participant→Person A0–A2 cadence. Nothing breaks mid-flight; the security claim swaps atomically with its consumers.

**P1 — Add the tier, don't read it yet.**
Add `model ProgramInstance` + nullable `Event.instanceId` (migration M0). No prod data to backfill; update the seed (§4b) so `seedBaseline` produces a def+instance and Events carry `instanceId`. No reads change; `Event.programId` still authoritative. Ships green — new table + nullable column, zero consumers.

**P2 — Move the child FKs onto the instance.**
Migration M1: add `instanceId` to `ProgramParticipant`/`ProgramVolunteer`/`Fee`, add `ProgramInstance.leadMentorId` + shopify/capacity/date/phase columns + the nullable `minAge`/`maxAge`/`orgMemberOnly` **narrowing-override** columns (§3a). **Prices stay on Program.** Wire the `effectiveEligibility()` resolver + the write-time widen guard. Update the seed macros (`createProgram`/`createEvent`, §4b) to build on `instanceId`. Old `programId` columns still authoritative for reads; writers dual-write program+instance so both stay consistent through P3. Ships green.

**P3 — Move reads, swap the security claim atomically.**
Cut every *read* to the instance: `buildCallerContext`, `scopeBindings`, `scopes.ts`, `registry.ts`, the event→instance→program hop, and **`programsLed` → `instancesLed`** across `auth-options`/`authClaims`/`next-auth.d.ts`/`program-ops/layout.tsx` — all in **one** PR. This is the dangerous phase: the JWT claim and its four consumers must flip together or lead mentors lose access mid-deploy. Writes still dual-write (P2). Run the **full** integration suite `--runInBand` — this is the net that catches the tsc-blind where-clause escapes.

**P4 — Flip writes + UI to the instance; enable multi-instance.**
`/program-ops/sessions/*` → `/program-ops/instances/*` (instance CRUD); the "New Event form" nests Events under a chosen instance. `programs/[id]` route splits: definition edit (name + baseline age/memberOnly + **board prices**) vs instance edit (dates/lead/capacity/phase/enrollment/shopify + narrowing age/memberOnly overrides). Public `/programs` + `/my-activities/programs` re-point per §6. Stop writing the legacy `Program` operational columns and drop the P2 dual-write.

**P5 — Drop the vacated Program columns.**
Migration M3: drop `leadMentorId`, `startAt`, `endAt`, `phase`, `enrollmentStatus`, `maxParticipants`, `leadMentorNotificationSettings`, `shopify*` from `Program` (**keep the price columns**), and drop `Event.programId`. Its own migration, RENAME/drop only. Grep-to-zero the old field names across all three test roots + `src` before merging.

---

## 8. Hazard checklist (this repo's scar tissue)

- [ ] **Prisma FK/relation renames are tsc-BLIND on where-clauses.** Variable-held or literal `where: {programId}` widens to `*WhereInput` and type-checks green, then throws at runtime. Grep every call site; integration tests are the only net. (`[[tsc-misses-prisma-rename-escapes]]`, `[[fk-rename-tsc-not-enough]]`)
- [ ] **Grep ALL THREE test roots** for the old field name: `src/**/__tests__`, `tests/`, `__tests__/`. Mocked tests compile green and break at runtime on renamed models. (`[[test-dirs-two-roots]]`, `[[mock-tests-tsc-blind-renames]]`)
- [ ] **FK rename touches security config beyond the schema:** `scopeBindings.ts` + `access-resolvers.ts` are **CODEOWNERS-gated**; `generated/classifications.ts` regenerates; the `scopeBindingsEquivalence.test.ts` + `rsvp-program-scope` + `emergency-contact-program-scope` oracles hardcode `programsLed`/`programId`; frontend response mocks carry the old shape. All tsc-blind on the string fixtures. (`[[fk-rename-touches-security-config]]`)
- [ ] **`pageRegistry.test.ts` fails on unregistered renamed routes.** `/program-ops/sessions/*` → `/program-ops/instances/*` must be updated in `pageRegistry` PAGES (or REGISTRY_EXCLUDED). (`[[page-registry-drift-guard]]`)
- [ ] **Integration tests `--runInBand` are the real net** — never parallel (shared DB corrupts counts / "too many clients"). Run via the package.json script, append ONE path regex to narrow; never hand-roll `--testPathIgnorePatterns` (it replaces the config array → 16-min hang). (`[[integration-tests-serial-only]]`, `[[jest-cli-ignore-overrides-config]]`, `[[no-background-jest]]`)
- [ ] **RENAME migrations, not drop+add** — preserves the capacity `FOR UPDATE` raw-SQL target and the `[programId, personId]` → `[instanceId, personId]` PK partial indexes. (`[[fk-rename-tsc-not-enough]]`)
- [ ] **Sliced-scope trap:** don't scope a rename chip to skip a subdir — the skipped subdir's consumers of the renamed route/wire-key break silently, tsc-blind. Grep repo-wide + grep-to-zero after merge. (`[[sliced-rename-cross-dir-consumers]]`, `[[git-grep-pathspec-no-recurse]]` — use `grep -r`, not `git grep -- 'dir/*'`)
- [ ] **Claim swap must be atomic with consumers** (P3) — JWT `instancesLed` + `layout.tsx` + `buildCallerContext` + `resolveAccess` flip in one PR, or every lead mentor is locked out mid-deploy.
- [ ] **`shop/certifications` IDOR alerts are usually false** (status is public by design) — don't let the security-test churn in P3 spawn noise there. (`[[cert-status-public-by-design]]`)

---

## 9. Decisions (product owner — LOCKED)

1. **Public `/programs` lists instances**, not definitions — open-enrollment `ProgramInstance` rows shown as a schedule ("Woodworking 101 — Fall 2026"). Public IA becomes a schedule; a definition-catalog view, if ever needed, is a separate staff surface. (§6)
2. **`ProgramInstance.name` is a stored, separate run label** ("Fall 2026") — not derived from `program.name + term`. Editable data; the run operator sets it. (§3)
3. **Policy narrowing** (§3a) confirmed: instance may narrow `minAge`/`maxAge`/`orgMemberOnly`, never widen; enforced by the write-time guard. An open definition correctly permits a member-only run; a member-only definition can't be loosened.
4. **Pricing stays on `Program` (single per definition).** Per-run pricing (early-bird) is a *someday-maybe*, not now — Shopify discount codes cover that case without a schema change. No instance price column and no override. If it ever becomes real, revisit then. (§2)
