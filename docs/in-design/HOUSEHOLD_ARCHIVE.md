# Archive households: structural exclusion for permanently departed families

Issues: [#1228](https://github.com/innovationtreehouse/checkin/issues/1228),
[#1232](https://github.com/innovationtreehouse/checkin/issues/1232)

## Problem

A household that has left the organisation permanently still appears in every
roster, dropdown, search result, and count the app produces. There is no way to
mark one as gone, because the `Household` model has no `archivedAt` column.

The obvious fix — add the column, filter it on every read — is the same pattern
`LIVE_PERSON` already proved does not work at scale. `LIVE_PERSON` is
`{ mergedIntoId: null }` applied by convention to Person queries; it produced 13
silent defects across a single widened sweep, including an authorization check a
merged-away identity could satisfy.

Household queries are a comparable surface: **14 direct read calls
(`findMany`/`findUnique`/`findFirst`/`count`) across 12 production files, plus
~74 relation traversals** (`household: { ... }`) that reach Household through
Person or other models. An opt-out `{ archivedAt: null }` filter on each of them
is the same bug class — forgettable, no compiler error on omission, leaks
silently — and would mint a second convention alongside `LIVE_PERSON`, doubling
the surface a drift guard has to cover.

`TOMBSTONE_REMOVAL.md`'s out-of-scope section calls this out explicitly: "a
second exclusion dimension … would mint a second forgettable convention and a
second drift guard."

## Objective

**Make it impossible to read an archived household from a query that did not ask
for one, rather than everyone's job to remember not to.**

Concretely: add `Household.archivedAt`, and make the Prisma client structurally
exclude archived households from every read by default, with an explicit opt-in
for the queries that legitimately need them.

## Executive summary

| | |
|---|---|
| **The fix** | A Prisma client extension auto-injects `{ archivedAt: null }` into every `household.*` read query. Queries that need archived rows opt in with a sentinel. |
| **Why not per-query filters** | `LIVE_PERSON` proved the convention does not hold. 13 defects from one sweep, and the drift guard that existed missed all three bugs that shipped. A second convention doubles the surface. |
| **What board members see** | A new "Archive" action on a household. Archived households disappear from every active surface. Historical reports and audit trails still show them. |
| **What developers stop doing** | Nothing — they never start. No filter to remember, no drift guard to maintain. |
| **What the extension cannot reach** | Raw SQL, relation-based traversals from other models (`person.findMany({ include: { household: true } })`). Those are a bounded set; see [What the extension does not cover](#what-the-extension-does-not-cover). |
| **Done when** | Archived households are invisible in every active surface (#1232) and the mechanism is structural, not conventional. |

## What "archived" means

**An archived household is one that has permanently left the organisation.**

It is not:

- **REVOKED membership.** Revocation is a membership-level state
  (`OrgMembership.status = REVOKED`). A revoked household keeps app access and
  loses facility privileges. Archival is the step beyond: the family is gone,
  the row is retained for audit, and nobody should encounter it in an active
  context.
- **A tombstone.** `LIVE_PERSON` marks a Person that was merged away — a
  data-hygiene artifact. Archival is a domain event: a real family departed.
- **DENIED membership.** Denial locks sign-in; archival does not. A denied
  household may later be archived, but the two are independent.

**When it happens:** a board member or sysadmin archives a household after the
family has left. This is a deliberate human act, not an automatic consequence of
any other state transition.

**Reversibility:** yes. Unarchiving restores the household to whatever state it
held before. The `archivedAt` timestamp is nulled. This follows the principle
that decisions are reversible — an archive of the wrong household can be undone.

## Mechanism evaluation

### Option A: per-query filter convention (rejected)

Add `archivedAt` and rely on every query site to include `{ archivedAt: null }`.
This is what `LIVE_PERSON` does for Person.

**Why not:** the failure evidence is already in. 113 Person query sites, 13
silent defects. 88 Household query sites would produce the same class. The drift
guard `TOMBSTONE_REMOVAL.md` argues against exists precisely because the
convention-plus-guard arrangement does not work.

### Option B: Postgres view (`active_household`) (considered, not recommended)

Create a view `active_household` that excludes `archivedAt IS NOT NULL`, and
route queries through it.

**Pros:** database-level enforcement, no application code to forget.

**Cons:** Prisma does not generate a typed client for views in any supported way.
The `@@view` directive exists but produces no query methods — the view would need
raw SQL or a second `@@map`'d model, losing type safety and breaking every
existing `prisma.household.*` call. The migration from `prisma.household` to
`prisma.activeHousehold` is a mechanical sweep of every call site — the same
scale of work as the filter, without the structural guarantee against new code.

### Option C: Prisma client extension (recommended)

A `Prisma.defineExtension` that intercepts every `household.*` read operation and
injects `{ archivedAt: null }` into the `where` clause. Queries that legitimately
need archived rows pass a sentinel value to opt out.

**Pros:**
- Structural. New code hitting `prisma.household.findMany()` gets the filter
  automatically — no convention to learn, no filter to forget.
- Already proven in this codebase: `emailNormalizeExtension` and
  `auroraResumeRetryExtension` both use the same `Prisma.defineExtension` API
  (Prisma 7.8).
- The opt-in sentinel makes legitimate exceptions explicit and grep-able, unlike
  the current LIVE_PERSON allowlist which is a separate file that can drift.
- No schema tricks, no views, no second model. Every existing
  `prisma.household.*` call works unchanged and gains the filter.

**Cons:**
- Does not reach relation traversals (see below).
- Does not reach raw SQL (no raw SQL reads Household today).
- The sentinel is a runtime convention — but it is opt-**in** (safe by default),
  not opt-**out** (unsafe by default), which inverts the failure mode.

### Option D: drift guard only (rejected)

Add the column, add a drift guard like `livePersonDriftGuard.test.ts`. Ship the
per-query filter plus a test that greps for missing ones.

**Why not:** this is what `LIVE_PERSON` has, and `TOMBSTONE_REMOVAL.md` is a
200-line argument that it does not work. The guard missed three shipped bugs
before its widening found 13 more. A second guard doubles the maintenance
without fixing the failure mode.

### Option E: separate table — move the row out (considered, not recommended)

This is the pattern TOMBSTONE_REMOVAL uses for Person: delete the `Person` row
entirely and record the merge in a separate `PersonMerge` table. The household
analogue: move the archived Household row to an `ArchivedHousehold` table, so
`prisma.household.*` structurally cannot return it.

**Pros:**
- The strongest structural guarantee. No filter, no extension, no sentinel — the
  row is not in the table, period. New code cannot read it by accident because
  there is nothing to read.
- No relation traversals to worry about — `Person.householdId` pointing at an
  archived household would fail (FK violation) or be repointed, making the
  exclusion total.
- Matches the TOMBSTONE_REMOVAL precedent.

**Cons — and why it does not transfer from Person:**
- **Live dependents.** The tombstone-removal design works because the merge
  **already moves everything** off the loser before deleting it — visits,
  enrollments, certifications, all repointed. An archived household still has
  live dependents: `Person.householdId` (every member), `OrgMembership`,
  `EmergencyContact[]`, `TrustedAdult[]`. Moving the row means either (a)
  cascading all of those to parallel archive tables (a second schema for a second
  copy of the world), or (b) nulling `Person.householdId` (violates "every person
  belongs to a household" — `people-households.md` Procedure), or (c) moving the
  Person rows too (now the person disappears from all history, not just active
  surfaces).
- **Reversibility.** Unarchiving a household means moving rows back: household,
  its members' FK references, membership, contacts, trusted adults. A merge is
  intentionally irreversible ("there is no un-merge"); archival is explicitly
  reversible. The row-move pattern works when the operation is one-way.
- **Historical queries.** Attendance reports, audit logs, and hours summaries
  reference `householdId`. With the row gone, those queries need a LEFT JOIN to
  `ArchivedHousehold` or lose the household name. `PersonMerge` avoids this
  because `AuditLog.affectedEntityId` is a bare `Int` with no FK — the
  Household references are typed FKs that would break.
- **Schema complexity.** `ArchivedHousehold` duplicates every column of
  `Household` plus a `archivedAt` timestamp. Every schema change to `Household`
  must also be applied to its archive twin — a maintenance surface that grows
  with the model.

**The core asymmetry:** a merged Person has no remaining purpose — it is a
data-hygiene artifact the system would prefer never existed. An archived
Household is a real family that left; its rows are still referenced by real
people and real history. The tombstone pattern removes something that should
never have stayed; the archive pattern retains something that needs to stop
being active. These are different operations, and the mechanism that fits
deletion does not fit retention.

## Recommended approach: Prisma client extension

### The extension

```typescript
export const householdArchiveExtension = Prisma.defineExtension({
    name: 'householdArchiveFilter',
    query: {
        household: {
            findMany({ args, query }) {
                args.where = injectArchiveFilter(args.where)
                return query(args)
            },
            findFirst({ args, query }) {
                args.where = injectArchiveFilter(args.where)
                return query(args)
            },
            findUnique({ args, query }) {
                args.where = injectArchiveFilter(args.where)
                return query(args)
            },
            findUniqueOrThrow({ args, query }) {
                args.where = injectArchiveFilter(args.where)
                return query(args)
            },
            count({ args, query }) {
                args.where = injectArchiveFilter(args.where)
                return query(args)
            },
            aggregate({ args, query }) {
                args.where = injectArchiveFilter(args.where)
                return query(args)
            },
        },
    },
})
```

`injectArchiveFilter` checks for the opt-out sentinel, and otherwise AND-merges
`{ archivedAt: null }` into the existing `where`. The sentinel is a specific
`archivedAt` value (e.g. `{ archivedAt: undefined }` replaced by a symbol or a
named constant like `INCLUDE_ARCHIVED`) that a caller passes to suppress the
auto-filter.

The extension is added to the client chain in `lib/prisma.ts`, alongside the
existing `emailNormalizeExtension` and `auroraResumeRetryExtension`.

### The opt-in sentinel

```typescript
/** Pass in a where clause to suppress the archive filter on that query. */
export const INCLUDE_ARCHIVED: Prisma.HouseholdWhereInput = {
    archivedAt: { not: { equals: undefined } },
}
// — or more practically, a recognizable shape the extension checks for:
export const INCLUDE_ARCHIVED_MARKER = Symbol('includeArchived')
```

The exact mechanism depends on what Prisma's `where` merging allows. The
simplest approach: the extension checks whether the caller's `where` already
contains an explicit `archivedAt` clause. If it does, the extension does not
inject its own — the caller is taking responsibility. If it does not, the
extension adds `archivedAt: null`.

This is the inverse of `LIVE_PERSON`: instead of a filter you must remember to
add, it is a filter you must explicitly remove. Forgetting is safe.

### What the extension does not cover

Prisma query extensions intercept top-level `prisma.household.*` calls but
**do not intercept relation traversals** — a `person.findMany({ include:
{ household: true } })` fetches the related Household without passing through the
extension.

This matters for two shapes:

1. **`include: { household: true }`** — pulls the Household as a nested object.
   The Household data is present, but the caller's Person query already decided
   which people to return. If the Person is active, their Household is their
   Household — archived or not, the relation is a fact. In most cases, this is
   fine: the caller is looking up a specific person's household, not listing
   households.

2. **`where: { household: { ... } }`** — filters Person rows by a Household
   condition. An archived household's members would still match. This is the
   shape that needs attention: a Person search that should exclude archived
   households must add `{ household: { archivedAt: null } }` to the Person where.

The bounded set of relation traversals is the #1232 sweep — ~74 sites, each
audited once. The extension handles the direct Household queries structurally;
the relation paths are a one-time sweep with a smaller, enumerable surface.

A drift guard for the relation paths alone (not the direct queries) is a
reasonable complement: it is much smaller than a guard covering everything, and
the direct-query half — the larger, more forgettable surface — is already
structural.

## What archival blocks

An archived household is excluded from every active surface:

| Surface | Blocked | Why |
|---|---|---|
| Membership-ops household list | yes | Board should not see departed families as active work |
| People search / dropdowns | yes | Archived members should not appear as candidates |
| Program enrollment | yes | Cannot enroll from a departed household |
| Membership processes | yes | No new intake, renewal, or payment for a departed family |
| Check-in / kiosk scan | yes (redirect) | Badge scan resolves to "household archived" message |
| Emergency-contact roster | yes | Not in the building |
| Compliance / audit worklists | yes | No obligations to track |
| Nav todo counts | yes | Should not inflate board counts |
| Unclaimed-households list | yes | Not a household to chase |
| Missing-contact list | yes | Not a household to chase |

## What archival allows (must still show archived rows)

| Surface | Allowed | Why |
|---|---|---|
| Admin audit / broken-households | yes | Data hygiene sees everything |
| Historical reports (attendance, hours) | yes | History is not rewritten |
| Audit log entries | yes | Audit trail is permanent |
| Admin household detail (direct link) | yes | Board can look up an archived household by id |
| Unarchive action | yes | Reversibility |

These are the sites that will use the opt-in sentinel.

## Migration

### Schema change

```prisma
model Household {
  // ... existing fields ...

  /// @sensitivity:public
  archivedAt DateTime?
}
```

- **Nullable `DateTime?`**, not a boolean. Timestamps record when it happened;
  `null` means active.
- **No backfill needed.** All existing households are active (`null`). The
  column is added as nullable with no default — a zero-downtime migration.
- **Sensitivity: `public`.** Whether a household is archived carries no private
  information — it is the same tier as `id` and `name`. The timestamp itself
  reveals nothing an absence from rosters would not.
- **No index initially.** The query sites use the extension's injected
  `archivedAt: null`, which on a column that is overwhelmingly null benefits
  from a partial index only once the archived population is non-trivial.
  Premature indexing is wasted. Add `@@index([archivedAt])` or a partial index
  when the archived count warrants it.

### Route for archival

A new mutation on the existing household admin route
(`/api/membership-ops/households/[id]`) — a PATCH setting `archivedAt`. Board
or sysadmin only. The unarchive is the same route nulling `archivedAt`.

No new route file, no new page. The action sits on the existing household
detail view.

## Interaction with #1456 (TOMBSTONE_REMOVAL)

If tombstones go away first (#1456 lands), `LIVE_PERSON` is deleted and the
Household archive filter is the only remaining exclusion dimension. The
extension approach means it is structural from day one — no convention, no drift
guard to maintain.

If the extension approach proves sound here, it could retroactively apply to
`LIVE_PERSON` as an interim measure while #1456 is in progress: a
`personTombstoneExtension` injecting `{ mergedIntoId: null }` into every
`person.*` read, replacing the manual `LIVE_PERSON` filter and its 31-entry
allowlist. That would make both exclusions structural, and #1456 would then
delete the Person extension along with the column.

This is not a dependency in either direction. #1228 does not need #1456 to land
first, and #1456 does not need this. But the extension pattern, once proven,
is available to both.

## Decisions needed

1. **Who can archive?** Proposed: board and sysadmin only. Not household leads —
   a family cannot archive itself. Confirm or adjust.

2. **What about the household's members?** When a household is archived, its
   Person rows remain. They are still searchable by name, still hold audit
   history. The archive is on the Household, not on its members — a person who
   moves to a different household is still a person. Confirm this is the right
   model, or whether archival should cascade to some person-level state.

3. **Check-in behavior.** A badge scan for a person in an archived household
   today would succeed (the person exists, the household exists). After
   archival, should the scan: (a) fail with a message ("household archived,
   contact the front desk"), (b) succeed silently (the person is still a
   person), or (c) something else? Proposed: (a), since a departed family
   scanning in is an event worth surfacing.

4. **Membership status interaction.** Archival is proposed as independent of
   `OrgMembership.status`. A household can be archived regardless of whether
   its membership is ACTIVE, REVOKED, NONE, or anything else. Archival is "this
   family is gone"; membership status is "what terms they left on." Confirm.

5. **The opt-in sentinel design.** The simplest implementation: the extension
   checks whether the caller's `where` already mentions `archivedAt`. If it
   does, the extension does not inject. This makes the opt-in visible (`where:
   { archivedAt: { not: null } }` or any explicit `archivedAt` clause) without
   a separate symbol. Confirm this is acceptable, or whether a more explicit
   sentinel is preferred.

## Test plan

- **Extension unit test:** `prisma.household.findMany()` with no where clause
  excludes archived households. Same for `findFirst`, `findUnique`, `count`.
- **Opt-in test:** a query with an explicit `archivedAt` clause returns archived
  rows.
- **Archive action:** PATCH sets `archivedAt`, household disappears from the
  standard list. PATCH nulling it restores.
- **Permission:** only board/sysadmin can archive. A household lead gets 403.
- **Relation traversal audit:** each of the ~74 relation sites is categorized as
  "needs filter" or "legitimately reads all" and tested accordingly (#1232).
- **Integration:** an archived household's members do not appear in people
  search, program enrollment dropdowns, compliance worklists, or nav counts.
- **Check-in:** badge scan for an archived household's member behaves per the
  decision above.
- **Regression:** no existing test breaks from the extension being added (the
  test DB has no archived households, so `archivedAt: null` matches everything).

## Out of scope

- **#1456 (tombstone removal).** The extension pattern here may inform it, but
  the two are independent issues with independent timelines.
- **Automatic archival.** No cron, no rule that archives after N years of
  inactivity. Archival is a human decision.
- **Person-level archival.** Archival is on the Household. A person who needs
  to disappear is a different problem (merge, or a future person-archive).
- **Bulk archival tooling.** If the board needs to archive 50 households at
  once, that is a UI feature built after the mechanism exists.
- **Data retention / GDPR deletion.** Archival retains the row. A deletion
  obligation would be a separate mechanism with different rules.
