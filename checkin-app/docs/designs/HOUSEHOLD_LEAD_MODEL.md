# Household-Lead model: dual source of truth for "which household is this person a lead of?"

**Status:** design investigation → **option (a1) BUILT** (2026-07-05), shipped as a
zero-downtime **expand-contract** in two PRs:
- **Expand PR #917 (merged):** additive `Person.isHouseholdLead` column + backfill + full
  reader/writer cutover + `@@index([householdId, isHouseholdLead])` (folded into
  `20260706110000_person_is_household_lead` on merge). The `HouseholdLead`
  **table AND Prisma model are kept** — frozen at backfill, unread/unwritten — so (a)
  draining old ECS tasks don't query a dropped table mid-deploy, and (b) `schema.prisma`
  still matches the physical DB (the drift check requires it). The scope binding + view-bag
  entries stay too; only the code that returns lead rows cut over to `householdMembers`.
- **Follow-up PR (contract) — BUILT (stacked on expand):**
  `DROP TABLE "HouseholdLead"` (`20260706130000_drop_household_lead`) + removed the Prisma
  model, both relations (`Person.householdLeads`, `Household.leads`), and the three
  `HouseholdLead` view-bag `returns:` entries in `security/registry.ts`, with
  `classifications.ts` regenerated. Merge only after expand is fully rolled out — never in
  the same release as the backfill (see DEPLOY_MIGRATION_ORDER_OF_OPERATIONS.md).

Verified: `tsc` clean, `eslint --max-warnings 0` clean, unit + integration green against a
throwaway seeded Postgres.
**Date:** 2026-07-05 · **Scope:** `checkin-app/` (paths below relative to it).

---

## 1. Problem statement

A person's household was recorded in **two** places:

- `Person.householdId` — the household of record
  ([schema.prisma:95](../../prisma/schema.prisma#L95)), a required FK.
- `HouseholdLead.householdId` — every lead row carried its **own** copy of a household id
  ([schema.prisma:228-238](../../prisma/schema.prisma#L228), PK `@@id([householdId, personId])`).

Leadership was decided by demanding the two **agree**:

```ts
// src/lib/household/leads.ts:19
const isLead = user.householdLeads.some((l) => l.householdId === user.householdId);
```

If a `HouseholdLead(householdId = A, personId = P)` row ever coexisted with
`Person(P).householdId = B`, P was **silently not a lead** — the join row existed but pointed
at the wrong household, so the `=== user.householdId` predicate was false. Nothing kept the
two ids in sync: no FK from `HouseholdLead` to `Person.householdId`, no DB `CHECK`, no trigger.
The invariant "a lead row's `householdId` equals its person's" was maintained purely by each
write path independently remembering to. **The correctness of an auth gate rested on an
equality the data model did not enforce.** The audit's Q18 sweep can only *detect* a
divergence after the fact, not prevent one.

### 1a. What the investigation found (correction to the premise)

The brief assumed the broken-households "assign a lead to a household they are not in" flow
*creates* an external lead (a mismatch). **It does not** (verified below, §3): every write
path derived the lead's `householdId` from the person's own `Person.householdId`, or cleaned
up stale rows on move. So there was **no code path producing a mismatch**. The dual source of
truth was a **latent structural hazard, not an active bug** — the invariant held by convention
across four call sites, and the moment a fifth (or an import script, or a manual DB edit)
forgot it, the gate broke with no compile-time or runtime tripwire. That's why a Q18 detector
exists.

---

## 2. Current model map (file:line)

| Thing | Location |
|---|---|
| `Person.householdId` (required FK) | [schema.prisma:95-96](../../prisma/schema.prisma#L95) |
| `HouseholdLead` model, PK `[householdId, personId]` | [schema.prisma:228-238](../../prisma/schema.prisma#L228) |
| The equality read (`isLead`) | [lib/household/leads.ts:19](../../src/lib/household/leads.ts#L19) |
| Central lead-insert helper `addHouseholdLead` (takes `householdId`) | [lib/household/leads.ts:56-104](../../src/lib/household/leads.ts#L56) |
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

DB-query form, `householdLeads: { some: { householdId } }` (same equality in Prisma):

- [lib/membership/review.ts:246](../../src/lib/membership/review.ts#L246), [:280](../../src/lib/membership/review.ts#L280) — stamps guardians' `lastBackgroundCheck`; emails parents.
- [lib/membership/renewal.ts:210](../../src/lib/membership/renewal.ts#L210) — background-check freshness.

**One reader does NOT use the equality:**
[api/membership-ops/participants/merge/route.ts:52](../../src/app/api/membership-ops/participants/merge/route.ts#L52) —
`isLead = mergeParticipant.householdLeads.length > 0` (any lead row, any household). This is a
*safety* guard (block merging away a lead who still has dependents), so a stale row here fails
**conservative** (over-blocks a merge), not a security over-grant.

---

## 3. Can a mismatch happen? Every write path, audited

Every lead row was created through `addHouseholdLead(db, householdId, personId)`
([leads.ts:76](../../src/lib/household/leads.ts#L76)) or a nested `leads: { create: {...} }`.
Where each caller got its `householdId`:

| Write path | Where `householdId` comes from | Consistent? |
|---|---|---|
| Promote to lead — [api/household/lead/route.ts:31,42](../../src/app/api/household/lead/route.ts#L31) | `targetHouseholdId = targetMember.householdId` — the target's **own** household | ✅ cannot mismatch |
| Member edit/promote — [api/household/member/route.ts:78](../../src/app/api/household/member/route.ts#L78) | acting lead's household; target verified in same household first ([:44](../../src/app/api/household/member/route.ts#L44)) | ✅ cannot mismatch |
| Move person to another household — [api/membership-ops/participants/[id]/household/route.ts:61,78-85](../../src/app/api/membership-ops/participants/%5Bid%5D/household/route.ts#L61) | updates `Person.householdId`, **then deletes** `HouseholdLead(personId, householdId = old)` | ✅ cleans up on move |
| Create-new-household on move — [same file:36-45](../../src/app/api/membership-ops/participants/%5Bid%5D/household/route.ts#L36) | nested `leads: { create: { personId } }` on the freshly created household | ✅ lead's household = new household |
| Participant merge — [api/membership-ops/participants/merge/route.ts:167](../../src/app/api/membership-ops/participants/merge/route.ts#L167) | deletes **all** `HouseholdLead where personId = mergeId`; `keepId` untouched; `Person.householdId` deliberately not moved ([:171-173](../../src/app/api/membership-ops/participants/merge/route.ts#L171)) | ✅ no orphan created |

**Conclusion:** no current path could produce a `HouseholdLead` whose `householdId` disagreed
with its person's. The broken-households un-break flow (POST is actually
[api/household/lead/route.ts](../../src/app/api/household/lead/route.ts), per
[brokenHouseholdsAPI.integration.test.ts:13,96-112](../../src/app/__tests__/brokenHouseholdsAPI.integration.test.ts#L96))
assigns the lead to `targetMember.householdId` — the person's own household. The test's phrase
"a household they are not in" refers to the **acting board member**, not the promoted lead;
the promoted lead *is* a member of the household it now leads
([test:53,104](../../src/app/__tests__/brokenHouseholdsAPI.integration.test.ts#L53)).

Residual ways a mismatch could still arise (none guarded structurally):
- A **future** write path inserting a lead row with a literal / mismatched household id.
- A raw-SQL migration, Zoho/CSV import ([lib/dev/zoho-import.ts](../../src/lib/dev/zoho-import.ts)), or manual DB edit.
- A refactor changing `Person.householdId` without the delete at
  [participants/[id]/household/route.ts:79](../../src/app/api/membership-ops/participants/%5Bid%5D/household/route.ts#L79)
  (that cleanup is easy to forget — 7 lines, after the update, guarded by an `if`, untested).

Risk profile: **safe today, one careless commit from unsafe, with detection-only backstop.**

---

## 4. The external-lead question — resolved

**Not a requirement. A lead must be a member of the household.** Every read site in §2 requires
`lead.householdId === person.householdId` (or the Prisma `some: { householdId }` equivalent);
**no consumer anywhere** treats a lead-of-another-household as valid. An external lead would be
silently invisible to emergency-contact management, membership intake/renewal, household
settings, member editing, onboarding, and background-check stamping — a feature no code can
observe. Combined with §3 (no path creates one), external leads are an **accident-only** state,
pure corruption if it occurs. This makes the `=== user.householdId` check **correct** (intended
semantics) and makes the *dual storage* the thing to fix.

> If a human knows of an intended future requirement for external / cross-household leads (a
> legal guardian in a different household, an org-appointed steward), that flips this
> conclusion to option (c). Nothing in current code implies it. **The one human decision** (§7).

---

## 5. Options

### Option (a) — Drop `HouseholdLead.householdId`; derive the household from `Person.householdId`

Leadership becomes "is this person flagged as a lead **of their own household**." Two shapes;
only one is a real end state:

- **a1 (the actual fix, BUILT):** replace the whole `HouseholdLead` join table with
  `Person.isHouseholdLead Boolean @default(false)`. The led household is, by definition,
  `Person.householdId`. The cap becomes "count persons in this household with
  `isHouseholdLead = true`."
- **a2 (staging step only — not a destination):** drop `HouseholdLead.householdId`, PK becomes
  `personId` alone. **The table then earns nothing:** PK admits at most one row per person, the
  household is read from the joined `Person`, so "a row exists for P" is precisely a boolean —
  isomorphic to a1's flag with an extra join. A join table pays for itself only on **many-to-many**
  (killed by §4) or **per-edge columns** (promoted-at/-by, a role enum — none exist, YAGNI).
  Keep a2 only as a two-migration path (drop column first, drop table later); the resting state
  is a1.

- **Mismatch:** *impossible by construction* — one household id.
- **Migration (LIVE DB):** destructive-shaped but the dropped data is **fully derivable** and,
  per §3/§4, always equal to `Person.householdId` — no information lost. Path: additively add
  the column → backfill → cut readers over → drop old column/table in a later migration; never a
  single drop-and-recreate. a1 also migrates the cap logic and the audit-log rows referencing
  `tableName: "HouseholdLead"` ([lead/route.ts:53](../../src/app/api/household/lead/route.ts#L53),
  [member/route.ts:83](../../src/app/api/household/member/route.ts#L83)).
- **Security-review surface:** touches the auth gate — must re-verify all §2 readers, but the
  change *simplifies* them (`isLead` collapses to a boolean), shrinking the surface long-term.
- **Blast radius:** every §2 read site + every `leads: { ... }` include (~15 sites, incl.
  broken-households `where: { leads: { none: {} } }` at
  [broken-households/route.ts:19](../../src/app/api/admin/broken-households/route.ts#L19)) reworked.
  a2 is a smaller diff (query shape survives) but leaves a one-column table; a1 is the cleaner end
  state, bigger sweep. Kills external leads — acceptable per §4.

### Option (b) — Keep the join, enforce the invariant at write

Add a DB-level guarantee that `HouseholdLead.householdId` always equals `Person.householdId`,
plus a single choke-point helper.

- **Mechanisms (DB-level is the real fix):**
  - A **trigger** on `HouseholdLead` insert/update and on `Person.householdId` update that
    rejects/repairs a divergence — the only option that also catches the "moved, lead row not
    cleaned" path *and* raw-SQL edits.
  - A plain `CHECK` **cannot** express it (it would need to read the `Person` row, which Postgres
    `CHECK` forbids) — so "add a CHECK" isn't available; it must be a trigger or redundant-FK trick.
  - App-level only (funnel every write through `addHouseholdLead`, forbid raw
    `householdLead.create`): weaker — exactly the convention that already holds, just written
    down. Doesn't stop imports or manual edits.
- **Mismatch:** prevented (trigger) or merely re-asserted (app-only).
- **Migration:** additive (add a trigger; no column change), lowest data risk. Must first
  backfill/repair any divergent rows or the trigger's first fire surfaces them.
- **Security-review surface:** readers unchanged, but a trigger is now security-relevant code
  outside the TS type system (invisible to `tsc`).
- **Blast radius:** smallest on the app, largest on "surprise" — a trigger that silently repairs
  or hard-rejects can make an unrelated `Person.householdId` update fail in production.

### Option (c) — Bless external leads; fix the read side

Declare external leads legitimate; change every read so leadership is "does a `HouseholdLead`
row exist for this person," household treated as a separate axis.

- **Mismatch:** ceases to be a bug *by redefinition*.
- **Migration:** none (schema unchanged).
- **Security-review surface:** **largest and riskiest.** Every §2 gate relies on the equality to
  scope a lead to one household; dropping it means each gate must answer "lead **of which**
  household?" and re-scope explicitly — get one wrong and you have a real **over-grant** (a lead
  of A editing B), the opposite of the current failure mode (§6).
- **Blast radius:** every read site, and the answer is "it depends what external leads should be
  *able* to do" — an unanswered policy question.
- **Verdict:** only correct **if** §4 is overturned by a human. Do not pursue speculatively.

### Recommendation (what shipped)

**End state = (a1): `Person.isHouseholdLead Boolean`** — the problem is two copies of one fact,
so the fix is to stop storing it twice, and once external leads are ruled out (§4) a lead is one
bit of state a boolean carries fully (no many-to-many, no per-edge columns). a2 reaches the same
guarantee with a smaller diff, so it's a fine *first migration* if staging, but not a resting
place. **a1 was landed directly, via an expand-contract** (see status block).

Sequencing note (as advised at decision time): because §3 showed we were safe today and the real
exposure was "a future write path forgets the convention," (b)'s app-level choke-point was a cheap
interim backstop; a1 then supersedes it. Avoid a DB trigger unless a1 slips; avoid (c) absent a
requirement.

---

## 6. Security note (the lead gate)

`isLead` feeds authorization, so a mismatch is an **authz** event.

- **Dominant failure mode = silent under-grant.** Every JS gate in §2 requires the equality; a
  lead row pointing at the *wrong* household never satisfies it, so a real lead is treated as a
  non-lead — a **lockout** that goes unreported as a security issue (users just file "I can't
  edit my household").
- **Compliance gap.** The Prisma-query readers ([review.ts:246](../../src/lib/membership/review.ts#L246),
  [renewal.ts:210](../../src/lib/membership/renewal.ts#L210)) *skip* a mismatched lead when
  stamping `lastBackgroundCheck` — a guardian's background check would silently not get stamped,
  a safety-adjacent miss.
- **No over-grant today** — every gate demands the equality, so a divergent row can't *grant*
  access to another household. The one non-equality reader (merge) fails conservative.
- **Option (c) would introduce over-grant risk** where none exists — the core reason (c) is
  human-gated.

Any change here goes through the security registry
([classifications.ts](../../src/security/generated/classifications.ts) appears among
`householdLeads` consumers) and the authz integration tests — a lead-gate change is exactly the
class `tsc` waves through and integration catches.

---

## 7. Human-decision status

1. **THE decision — external / cross-household leads?** **Resolved: no** (§4); a1 was built on
   that basis. Reopen only if a human wants external leads (guardian in another household,
   org-appointed steward) — that flips the answer to (c) with explicit per-household scoping.
2. **a1 directly or staged via a2?** **Resolved: a1 directly**, as a two-migration expand-contract
   (status block) — not a2.
3. **b's DB trigger acceptable?** Moot — a1 shipped instead of (b).
4. **Still open:** should the sync-on-move cleanup at
   [participants/[id]/household/route.ts:79](../../src/app/api/membership-ops/participants/%5Bid%5D/household/route.ts#L79)
   get a dedicated integration test? It's the one place that kept the two ids in sync on a move
   and it's untested for that behavior — independent of which option shipped.

---

## 8. Relationship to tracked work

- [UNFINISHED.md](./UNFINISHED.md)'s **"`household` vs `family`"** ([:163](./UNFINISHED.md#L163))
  is a **vocabulary** item (code `Household`, UI "family"); this is **data-integrity / authz**.
  Orthogonal — **keep separate.** Don't fold a security-gate change into a copy sweep.
- UNFINISHED's **"dependent = non-lead"** thread ([:177-188](./UNFINISHED.md#L177),
  [:337-339](./UNFINISHED.md#L337)) confirms "lead" is already load-bearing ("promotion allows a
  non-lead adult → lead"); it renames around the *non-lead* side, not how leadership is *stored*.
  This doc is the storage-side companion.
- The shipped **`Participant` → `Person` rename** already moved these FKs to `personId`; a rename
  of `HouseholdLead` (a1) should reuse that sweep's grep-every-consumer discipline.

Recommend a short [UNFINISHED.md](./UNFINISHED.md) entry pointing here (now resolved as a1-BUILT).
