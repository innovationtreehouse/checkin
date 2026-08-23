# Purge date of birth from audit-log JSON (#1507)

## Problem

When a person crosses age 26, the nightly cron purges `Person.dateOfBirth` and
the write-time guard (`normalizeAdultDob`) prevents re-entry. But
`AuditLog.oldData` / `newData` — untyped JSON columns — still hold the date of
birth from edits made before or after the purge. The original requirement was
"deep delete — no record of it." The audit half was never completed.

The residue is not one-time: a 17-year-old's member-edit today legitimately
records their DOB. Nine years later the nightly cron purges the `Person` row,
but the audit blob still holds it. New residue accrues continuously as people
age past 26.

## Objective

No audit row holds a date of birth for anyone whose `Person.dateOfBirth` is
null (i.e. purged). This is both a retroactive cleanup (historical residue) and
a durable invariant (no new DOB enters audit going forward).

## Executive summary

- **Durable fix (option A):** strip `dateOfBirth` from the object before it
  enters `newData`/`oldData` at every `tableName: "Person"` audit site that
  currently includes it. Three sites need changes; three are already safe.
- **One-time migration:** a data migration removes `dateOfBirth` from historical
  audit JSON for any person whose `Person.dateOfBirth` is currently null.
- **What does not change:** audit rows themselves are never deleted; only the
  one key is stripped.

---

## Decision: option A over option B

**Option A — stop writing DOB to audit blobs.** If the key never enters audit,
nothing can outlive anything. The invariant is structural: there is no window
between a write and a scrub in which the data exists.

**Option B — extend the nightly purge** to scrub audit JSON alongside the
`Person` column. Preserves audit fidelity (the blob records what the form
actually saved at the time) but introduces a window: between the edit and the
next nightly run, the DOB sits in audit JSON accessible to anyone who can read
audit logs.

**Recommendation: A.** The requirement was "no record of it." A structural
invariant (never written) is stronger than a runtime scrub (written, then
erased). Option B's audit-fidelity argument is real — an auditor loses the
ability to see that a DOB was part of an edit — but the privacy posture
outweighs it here. The nightly cron already logs `{ field: 'dateOfBirth',
reason: 'aged_out_over_25' }` as a record that a purge happened, without
recording the value itself.

---

## Affected audit sites

All `auditLog.create` calls with `tableName: "Person"` were audited. Three
write DOB; three are already safe.

### Needs fix

| File | Line | What goes into audit | Fix |
|------|------|---------------------|-----|
| `src/app/api/household/member/route.ts` | 117 | `newData: updatedHouseholdMember` — selected via `HOUSEHOLD_PEER_SELECT`, which includes `dateOfBirth` | Destructure out `dateOfBirth` before writing |
| `src/app/api/profile/route.ts` | 75 | `newData: updatedProfile` — select includes `dateOfBirth` | Destructure out `dateOfBirth` before writing |
| `src/app/api/membership-ops/participants/merge/route.ts` | 564 | `oldData` embeds `personPreImage()` which captures `dateOfBirth` | Strip from `personPreImage` return |

### Already safe

| File | Line | Why safe |
|------|------|---------|
| `src/app/api/household/route.ts` | 124 | Writes `{ householdId, email, name }` — no DOB |
| `src/app/api/household/lead/route.ts` | 49, 126 | Writes `{ householdId, participantId, isHouseholdLead }` — no DOB |
| `src/app/api/membership-ops/participants/[id]/route.ts` | 76 | Already destructures out DOB: `const { dateOfBirth: priorDob, ...prior }` |
| `src/app/api/membership-ops/participants/[id]/household/route.ts` | 84 | Writes `{ householdId }` only |
| `src/app/api/cron/nightly/route.ts` | 99 | Writes `{ field: 'dateOfBirth', reason: 'aged_out_over_25' }` — the event, never the value |

---

## Durable fix: strip DOB at write time

The pattern at each site: destructure `dateOfBirth` out of the object before
passing it to `newData` or `oldData`.

```ts
// Before:
newData: updatedHouseholdMember

// After:
const { dateOfBirth: _dob, ...auditData } = updatedHouseholdMember;
// ...
newData: auditData
```

### Site 1: `household/member/route.ts`

`updatedHouseholdMember` comes from a `person.update(..., select: HOUSEHOLD_PEER_SELECT)`.
Destructure before the audit call at line 117.

### Site 2: `profile/route.ts`

`updatedProfile` comes from `person.update` with a select including `dateOfBirth`.
Destructure before the audit call at line 75.

### Site 3: `membership-ops/participants/merge/route.ts`

`personPreImage()` (line 50) explicitly lists `dateOfBirth: p.dateOfBirth`.
Remove that line from the function. This strips DOB from both the merge-target
and the keeper pre-images in `oldData`.

---

## One-time migration: historical residue

Ship as a Prisma migration. Irreversible by design — "no record of it" demands
exactly that.

```sql
-- Strip dateOfBirth from newData where the Person's DOB has since been purged.
UPDATE "AuditLog" a
   SET "newData" = a."newData" - 'dateOfBirth'
  FROM "Person" p
 WHERE a."tableName" = 'Person'
   AND a."affectedEntityId" = p.id
   AND p."dateOfBirth" IS NULL
   AND a."newData" ? 'dateOfBirth'
   AND a."newData"->>'dateOfBirth' IS NOT NULL;

-- Strip dateOfBirth from oldData (merge pre-images).
-- oldData may be nested (merge stores keeper under a `keeper` key), so handle
-- both top-level and nested.
UPDATE "AuditLog" a
   SET "oldData" = a."oldData" - 'dateOfBirth'
  FROM "Person" p
 WHERE a."tableName" = 'Person'
   AND a."affectedEntityId" = p.id
   AND p."dateOfBirth" IS NULL
   AND a."oldData" ? 'dateOfBirth'
   AND a."oldData"->>'dateOfBirth' IS NOT NULL;

-- Merge route nests a `keeper` object inside oldData that also carries DOB.
-- Strip it from the nested object for rows where the keeper's DOB is purged.
UPDATE "AuditLog" a
   SET "oldData" = jsonb_set(
       a."oldData",
       '{keeper}',
       (a."oldData"->'keeper') - 'dateOfBirth'
   )
  FROM "Person" p
 WHERE a."tableName" = 'Person'
   AND a."oldData"->'keeper' ? 'dateOfBirth'
   AND a."oldData"->'keeper'->>'id' IS NOT NULL
   AND p.id = (a."oldData"->'keeper'->>'id')::int
   AND p."dateOfBirth" IS NULL;
```

**Properties:**
- Self-sizing: no-op when nothing matches. Safe to run on any environment.
- Idempotent: re-running changes nothing (the WHERE clause requires the key to
  exist with a non-null value).
- Preserves all other audit fields and the row itself.
- A youth whose DOB is legitimately still on their `Person` row is untouched —
  the `p."dateOfBirth" IS NULL` join ensures only purged people are affected.

**Precedent:** `20260724120000_purge_adult_dob` was itself a one-time data fix
shipped as a migration.

---

## Open questions

1. **`oldData` in the merge route's nested structure.** The merge route stores
   `{ ...personPreImage(merged), keeper: personPreImage(keeper) }`. The third
   SQL statement handles the nested `keeper` key. Are there other nesting
   patterns in historical data (from earlier versions of the merge code) that
   this misses? A count query before running would verify:
   ```sql
   SELECT count(*) FROM "AuditLog"
    WHERE "tableName" = 'Person'
      AND "oldData"::text LIKE '%dateOfBirth%'
      AND "oldData" ? 'keeper';
   ```

2. **Import route.** `membership-ops/participants/import/route.ts` writes
   `tableName: "Household"` (not "Person") for its audit log. Confirmed safe,
   but worth a second look if the import path ever gains a per-person audit row.
