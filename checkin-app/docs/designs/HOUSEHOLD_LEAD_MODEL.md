# Household-Lead model: dual source of truth for "which household is this person a lead of?"

**Status:** design investigation → **option (a1) BUILT** (2026-07-05), shipped as a
zero-downtime **expand-contract** in two PRs:
- **This PR (expand):** additive `Person.isHouseholdLead` column + backfill
  (`20260706110000_person_is_household_lead`) + full reader/writer cutover + an index
  (`20260706120000`, `@@index([householdId, isHouseholdLead])`). The `HouseholdLead`
  **table AND its Prisma model are kept** — unused, frozen at backfill, no code reads or
  writes them — so (a) draining old ECS tasks don't query a dropped table during the
  rolling deploy, and (b) `schema.prisma` still matches the physical DB (the drift check
  requires it). The scope binding + view-bag entries stay too; only the code that returns
  lead rows was cut over to `householdMembers`.
- **Follow-up PR (contract):** `DROP TABLE "HouseholdLead"` + remove the model, relations,
  scope binding, and view-bag entries together — merged only after this PR is fully rolled
  out. Do NOT drop in the same release as the backfill (see DEPLOY_MIGRATION_ORDER_OF_OPERATIONS.md).

Verified: `tsc` clean, `eslint --max-warnings 0` clean, unit + integration suites green
against a throwaway seeded Postgres.
**Date:** 2026-07-05
**Scope:** `checkin-app/` (paths below are relative to `checkin-app/`).

---

## 1. Problem statement

A person's household is recorded in **two** places:

- `Person.householdId` — the person's household of record
  ([prisma/schema.prisma:95](../../prisma/schema.prisma#L95)), a required
  (non-nullable) FK.
- `HouseholdLead.householdId` — every lead row carries its **own** copy of a
  household id ([prisma/schema.prisma:228-238](../../prisma/schema.prisma#L228),
  PK `@@id([householdId, personId])`).

Leadership is then decided by demanding the two **agree**. The smoking gun:

```ts
// src/lib/household/leads.ts:19
const isLead = user.householdLeads.some((l) => l.householdId === user.householdId);
```

If a `HouseholdLead(householdId = A, personId = P)` row ever coexists with
`Person(P).householdId = B`, then P is **silently not a lead** — the join row
exists but points at the wrong household, so the `=== user.householdId`
predicate is false. Nothing in the schema keeps the two ids in sync: there is
no FK from `HouseholdLead` to `Person.householdId`, no DB `CHECK`, no trigger.
The invariant "a lead row's `householdId` equals its person's `householdId`" is
maintained purely by each write path independently remembering to do so.

That is the design smell: **the correctness of an auth gate rests on an
equality that the data model does not enforce.** The audit's Q18 sweep can only
*detect* a divergence after the fact; it cannot prevent one.

### 1a. What the investigation actually found (correction to the premise)

The brief assumed the broken-households "assign a lead to a household they are
not in" flow *creates* an external lead (a mismatch). **It does not.** Verified
below (§3): every current write path derives the lead's `householdId` from the
person's own `Person.householdId`, or cleans up stale rows on move. So today
there is **no code path that produces a mismatch**. The dual source of truth is
a **latent structural hazard**, not an active bug — the invariant holds by
convention across four call sites, and the moment a fifth write path (or an
import script, or a manual DB edit) forgets the convention, the gate breaks
with no compile-time or runtime tripwire. That is precisely why a Q18 detector
exists.

---

## 2. Current model map (file:line)

| Thing | Location |
|---|---|
| `Person.householdId` (required FK) | [schema.prisma:95-96](../../prisma/schema.prisma#L95) |
| `HouseholdLead` model, PK `[householdId, personId]` | [schema.prisma:228-238](../../prisma/schema.prisma#L228) |
| The equality read (`isLead`) | [lib/household/leads.ts:19](../../src/lib/household/leads.ts#L19) |
| Central lead-insert helper `addHouseholdLead` (takes `householdId` as a param) | [lib/household/leads.ts:56-104](../../src/lib/household/leads.ts#L56) |
| Per-household lead cap `MAX_HOUSEHOLD_LEADS = 2` | [lib/household/leads.ts:40](../../src/lib/household/leads.ts#L40) |

### Read sites that depend on the equality (the blast surface)

JS-side, `l.householdId === user.householdId`:

- [lib/household/leads.ts:19](../../src/lib/household/leads.ts#L19) — `householdLeadship` / `leadHousehold`: gates emergency-contact + household management.
- [lib/membership/external.ts:178](../../src/lib/membership/external.ts#L178), [:266](../../src/lib/membership/external.ts#L266) — external membership actions (apply / renew).
- [lib/membership/intake.ts:78](../../src/lib/membership/intake.ts#L78) — "only a household lead can manage the membership application".
- [api/household/settings/route.ts:40](../../src/app/api/household/settings/route.ts#L40) — edit household settings.
- [api/household/member/route.ts:31](../../src/app/api/household/member/route.ts#L31),[:39](../../src/app/api/household/member/route.ts#L39) — via `householdLeadship().canManage`: edit/promote members.
- [api/membership/renewal-status/route.ts:23](../../src/app/api/membership/renewal-status/route.ts#L23) — renewal visibility.
- [api/profile/onboarding-status/route.ts:31](../../src/app/api/profile/onboarding-status/route.ts#L31), [api/profile/onboarding/route.ts:38](../../src/app/api/profile/onboarding/route.ts#L38) — onboarding lead flag / emergency-contact requirement.

DB-query form, `householdLeads: { some: { householdId } }` (same equality, expressed in Prisma):

- [lib/membership/review.ts:246](../../src/lib/membership/review.ts#L246), [:280](../../src/lib/membership/review.ts#L280) — stamps guardians' `lastBackgroundCheck`; emails parents.
- [lib/membership/renewal.ts:210](../../src/lib/membership/renewal.ts#L210) — background-check freshness.

**One reader does NOT use the equality:**
[api/membership-ops/participants/merge/route.ts:52](../../src/app/api/membership-ops/participants/merge/route.ts#L52) —
`isLead = mergeParticipant.householdLeads.length > 0` (any lead row, any
household). This is a *safety* guard (block merging away a lead who still has
dependents), so a stale row here fails **conservative** (over-blocks a merge),
not a security over-grant. Noted for completeness.

---

## 3. Can a mismatch happen? Every write path, audited

Every lead row is created either through `addHouseholdLead(db, householdId,
personId)` ([leads.ts:76](../../src/lib/household/leads.ts#L76)) or a nested
Prisma `leads: { create: {...} }`. Here is where each caller gets its
`householdId`:

| Write path | Where `householdId` comes from | Consistent? |
|---|---|---|
| Promote to lead — [api/household/lead/route.ts:31,42](../../src/app/api/household/lead/route.ts#L31) | `targetHouseholdId = targetMember.householdId` — the target's **own** household | ✅ cannot mismatch |
| Member edit/promote — [api/household/member/route.ts:78](../../src/app/api/household/member/route.ts#L78) | `householdId` = acting lead's household; target verified in same household first ([:44](../../src/app/api/household/member/route.ts#L44)) | ✅ cannot mismatch |
| Move person to another household — [api/membership-ops/participants/[id]/household/route.ts:61,78-85](../../src/app/api/membership-ops/participants/%5Bid%5D/household/route.ts#L61) | Updates `Person.householdId`, **then deletes** `HouseholdLead(personId, householdId = old)` | ✅ cleans up on move |
| Create-new-household on move — [same file:36-45](../../src/app/api/membership-ops/participants/%5Bid%5D/household/route.ts#L36) | Nested `leads: { create: { personId } }` on the freshly created household | ✅ lead's household = new household |
| Participant merge — [api/membership-ops/participants/merge/route.ts:167](../../src/app/api/membership-ops/participants/merge/route.ts#L167) | Deletes **all** `HouseholdLead where personId = mergeId`; `keepId` untouched; `Person.householdId` deliberately not moved ([:171-173](../../src/app/api/membership-ops/participants/merge/route.ts#L171)) | ✅ no orphan created |

**Conclusion:** none of the current paths can produce a `HouseholdLead` whose
`householdId` disagrees with its person's `householdId`. The
broken-households un-break flow (the POST is actually
[api/household/lead/route.ts](../../src/app/api/household/lead/route.ts), per
[brokenHouseholdsAPI.integration.test.ts:13,96-112](../../src/app/__tests__/brokenHouseholdsAPI.integration.test.ts#L96))
assigns the lead to `targetMember.householdId` — the person's own household. The
test's phrase "a household they are not in" refers to the **acting board member**
not being a member of the household, **not** to the promoted lead. The promoted
lead (`brokenAdultId`) *is* a member of the household it now leads
([test:53,104](../../src/app/__tests__/brokenHouseholdsAPI.integration.test.ts#L53)).

Residual ways a mismatch could still arise (none guarded structurally):

- A **future** write path that inserts a lead row with a literal / mismatched household id.
- A raw-SQL migration, Zoho/CSV import ([lib/dev/zoho-import.ts](../../src/lib/dev/zoho-import.ts)), or manual DB edit.
- A refactor that changes `Person.householdId` without the delete at
  [participants/[id]/household/route.ts:79](../../src/app/api/membership-ops/participants/%5Bid%5D/household/route.ts#L79)
  (that cleanup is easy to forget — it is 7 lines, after the update, guarded by
  an `if`, and untested for the *cleanup* specifically).

So the risk profile is: **safe today, one careless commit from unsafe, with
detection-only backstop.**

---

## 4. The external-lead question — resolved

Is an "external lead" (a lead who is not a member of the household they lead) a
real requirement, or an accident?

**Resolved: not a requirement. A lead must be a member of the household.**

Evidence: *every* read site in §2 requires `lead.householdId ===
person.householdId` (or the Prisma `some: { householdId }` equivalent). There is
**no consumer anywhere** that treats a lead-of-another-household as a valid
lead. An external lead would be silently invisible to all of: emergency-contact
management, membership intake/renewal, household settings, member editing,
onboarding, and background-check stamping. A feature that no code can observe is
not a feature. Combined with §3 (no path creates one), external leads are an
**accident-only** state — pure corruption if it ever occurs.

This makes the `=== user.householdId` check **correct** (it is the intended
semantics), and makes the *dual storage* the thing to fix — not the read.

> If a human knows of an intended future requirement for external / cross-household
> leads (e.g. a legal guardian in a different household, an org-appointed steward),
> that would flip this conclusion and make option (c) the answer instead. Nothing
> in the current code implies it. **Flagged as the one human decision** (see §7).

---

## 5. Options

### Option (a) — Drop `HouseholdLead.householdId`; derive the household from `Person.householdId`

Leadership becomes "is this person flagged as a lead **of their own
household**." Two shapes — but only one is a real end state:

- **a1 (the actual fix):** replace the whole `HouseholdLead` join
  table with `Person.isHouseholdLead Boolean @default(false)`. A person's led
  household is, by definition, `Person.householdId`. The cap
  ([leads.ts:40](../../src/lib/household/leads.ts#L40)) becomes "count persons in
  this household with `isHouseholdLead = true`".
- **a2 (staging step only — not a destination):** drop `HouseholdLead.householdId`,
  PK becomes `personId` alone. **But then the table earns nothing.** With
  `householdId` gone, the PK admits at most one row per person, and the household
  is read from the joined `Person` — so "a row exists for P" is precisely a
  boolean, and the table is isomorphic to a1's flag with an extra join. A join
  table pays for itself when it carries **many-to-many** (a person leading
  several households — killed by §4) or **per-edge columns** (promoted-at,
  promoted-by, a lead-role enum — none exist, YAGNI). Neither applies, so a2 is a
  one-column table that models a boolean. Keep it only if you want to land the
  change in two migrations (drop column first, drop table later); the resting
  state is a1.

- **Mismatch:** *impossible by construction* — there is only one household id.
- **Migration (LIVE DB — see [[live-data-migrations-must-preserve]]):**
  destructive-shaped (drops a column / table), but the dropped data is
  **fully derivable** and, per §3/§4, currently always equal to
  `Person.householdId` — so no information is lost. Path: (1) additively add the
  new column/`isHouseholdLead`; (2) backfill from existing rows; (3) cut readers
  over; (4) drop the old column/table in a later migration. Never a single
  drop-and-recreate. a1 also has to migrate the cap logic and the audit-log rows
  that reference `tableName: "HouseholdLead"`
  ([lead/route.ts:53](../../src/app/api/household/lead/route.ts#L53),
  [member/route.ts:83](../../src/app/api/household/member/route.ts#L83)).
- **Security-review surface:** touches the auth gate — must re-verify all §2
  readers. But the change *simplifies* them (`isLead` collapses to a boolean),
  which shrinks the surface long-term.
- **Blast radius:** every §2 read site + every `leads: { ... }` Prisma include
  (~15 sites, incl. broken-households `where: { leads: { none: {} } }` at
  [broken-households/route.ts:19](../../src/app/api/admin/broken-households/route.ts#L19)
  and the audit queries) must be reworked. a2 is a smaller diff than a1 (query
  shape survives) but leaves a one-column table; a1 is the cleaner end state but
  a bigger sweep. Kills external leads — acceptable per §4.

### Option (b) — Keep the join, enforce the invariant at write

Add a DB-level guarantee that `HouseholdLead.householdId` always equals the
person's `Person.householdId`, plus a single choke-point helper.

- **Mechanisms (pick one, DB-level is the real fix):**
  - A **trigger** on `HouseholdLead` insert/update and on `Person.householdId`
    update that rejects/repairs a divergence. This is the only option that also
    catches the "person moved, lead row not cleaned" path *and* raw-SQL edits.
  - A plain `CHECK` **cannot** express it — it would need to read the `Person`
    row (cross-row), which Postgres `CHECK` forbids. So "add a CHECK" is not
    actually available here; it must be a trigger or a redundant-FK trick.
  - App-level only (funnel every write through `addHouseholdLead` + forbid raw
    `householdLead.create`): weaker — it is exactly the convention that already
    holds today, just written down. Does not stop imports or manual edits.
- **Mismatch:** prevented (trigger) or merely re-asserted (app-only).
- **Migration:** additive (add a trigger; no column change). Lowest data risk of
  the three. Must first backfill/repair any existing divergent rows or the
  trigger's first fire on an update will surface them.
- **Security-review surface:** the gate keeps its current shape, so readers are
  unchanged — but a trigger is now security-relevant code that a reviewer must
  read and that lives outside the TS type system (invisible to `tsc`, per
  [[fk-rename-tsc-not-enough]]).
- **Blast radius:** smallest on the app (readers untouched). Largest on the
  "surprise" axis — a trigger that silently repairs or hard-rejects a write can
  make an unrelated `Person.householdId` update fail in production.

### Option (c) — Bless external leads; fix the read side

Declare external leads legitimate; change every read so leadership is "does a
`HouseholdLead` row exist for this person", with household treated as a separate
axis.

- **Mismatch:** ceases to be a bug *by redefinition* — the two ids are allowed to
  differ.
- **Migration:** none (schema unchanged).
- **Security-review surface:** **largest and riskiest.** Every §2 gate currently
  *relies* on the equality to scope a lead to one household. Dropping the
  equality means each gate must instead answer "lead **of which** household?" and
  re-scope explicitly — get one wrong and you have a real **over-grant** (a lead
  of household A editing household B). This is the opposite of the current
  failure mode (§6).
- **Blast radius:** every read site, and the answer is "it depends what external
  leads should be *able* to do" — a policy question with no current answer.
- **Verdict:** only correct **if** §4 is overturned by a human. Do not pursue
  speculatively.

### Recommendation

**Structural end state = (a1): `Person.isHouseholdLead Boolean`.** Ship (b)'s
app-level choke-point now as a cheap interim guard; do not do (c) unless a human
overturns §4.

Reasoning, ponytail-style: the problem is "two copies of one fact," so the
honest fix is to stop storing it twice — that is (a). The right *shape* of (a)
is a **boolean on `Person`** (a1), because once external leads are ruled out
(§4) a lead is one bit of state about a person, and the `HouseholdLead` table
carries nothing a bit can't: no many-to-many, no per-edge columns. a2 (drop the
column, keep the table) reaches the same impossible-by-construction guarantee
and is a smaller diff, so it is a fine **first migration** if you want to stage
the change — but it is not a resting place; the table it leaves behind is a
boolean wearing a join-table costume. Land a1, optionally via a2.

Sequencing: because §3 shows we are safe **today** and the real exposure is "a
future write path forgets the convention," (b)'s app-level choke-point (funnel
all writes through `addHouseholdLead`, forbid raw `householdLead.create`) is a
cheap backstop to add immediately, before the schema work is scheduled. The a1
migration then supersedes it. Avoid a DB trigger unless a1 slips indefinitely.
Avoid (c) entirely absent a requirement.

---

## 6. Security note (the lead gate)

`isLead` feeds authorization, so a mismatch is an **authz** event, not a
cosmetic one.

- **Dominant failure mode = silent under-grant.** Every JS gate in §2 requires
  `l.householdId === user.householdId`. A lead row pointing at the *wrong*
  household never satisfies it, so the real lead is treated as a non-lead: they
  cannot edit members, manage emergency contacts, manage the membership
  application, or see renewal. This is a **lockout**, which tends to go
  unreported as a security issue (users just file "I can't edit my household").
- **Compliance gap.** The Prisma-query readers
  ([review.ts:246](../../src/lib/membership/review.ts#L246),
  [renewal.ts:210](../../src/lib/membership/renewal.ts#L210)) *skip* a mismatched
  lead when stamping `lastBackgroundCheck`. A guardian whose lead row diverged
  would silently not get their background-check stamped — a safety-adjacent miss,
  not just an inconvenience.
- **No over-grant found today.** Because every gate demands the equality, a
  divergent row cannot *grant* access to another household. The one non-equality
  reader (merge, [merge/route.ts:52](../../src/app/api/membership-ops/participants/merge/route.ts#L52))
  fails conservative.
- **Option (c) would introduce over-grant risk** where none exists now — that is
  the core reason to treat (c) as human-gated.

Any change here must go through the security registry
([src/security/generated/classifications.ts](../../src/security/generated/classifications.ts)
appears among `householdLeads` consumers) and the authz integration tests — a
lead-gate change is exactly the class that `tsc` waves through and integration
catches (see [[fk-rename-tsc-not-enough]], [[fk-rename-touches-security-config]]).

---

## 7. Open questions for a human

1. **THE decision — are external / cross-household leads ever intended?** §4
   says no (nothing in code wants them). If a human confirms "a lead is always a
   member," proceed with (a2)/(b). If a human wants external leads (guardian in
   another household, org-appointed steward), the answer flips to (c) and the
   read-side gets reworked with explicit per-household scoping. **Everything
   downstream hinges on this.**
2. If (a): land **a1 (boolean on Person)** directly, or stage it through a2
   (drop column now, drop table later)? a2 alone is not a valid end state — with
   `householdId` gone the table only models a boolean. Question is purely
   one-migration vs two, weighed against the cap + audit-log rework a1 drags in.
3. If (b): is a **DB trigger** acceptable in this codebase (security-relevant
   logic outside TS/`tsc` visibility), or is the app-level choke-point + a Q18
   *detector* the pragmatic ceiling?
4. Should the **cleanup at
   [participants/[id]/household/route.ts:79](../../src/app/api/membership-ops/participants/%5Bid%5D/household/route.ts#L79)**
   get a dedicated integration test regardless of which option ships? It is the
   one place today that keeps the two ids in sync on a move, and it is untested
   for that behavior.

---

## 8. Relationship to tracked work

- [UNFINISHED.md](./UNFINISHED.md) **"`household` vs `family` — keep the split,
  or unify?"** ([UNFINISHED.md:163](./UNFINISHED.md#L163)) is a **vocabulary**
  item (code `Household`, UI "family"). This is a **data-integrity / authz**
  item. They are orthogonal — **keep this separate.** Do not fold a security
  gate change into a copy sweep.
- UNFINISHED.md's **"dependent = non-lead"** thread
  ([UNFINISHED.md:177-188](./UNFINISHED.md#L177),
  [:337-339](./UNFINISHED.md#L337)) confirms "lead" is already a load-bearing
  concept ("promotion allows a non-lead adult → lead"). That thread renames
  around the *non-lead* side; it does not touch how leadership is *stored*. This
  doc is the missing companion on the storage side.
- The shipped **`Participant` → `Person` rename** (see
  [[child-vs-youth-terminology]]) already moved these FKs to `personId`; this
  investigation assumes that landed model. No dependency, but a rename of
  `HouseholdLead` (option a1) should reuse that sweep's grep-every-consumer
  discipline ([[sliced-rename-cross-dir-consumers]],
  [[mock-tests-tsc-blind-renames]]).

Recommend: add a short entry to [UNFINISHED.md](./UNFINISHED.md) pointing here,
under a new "🟡 Household-lead dual source of truth" heading, gated on the §7.1
human decision.
