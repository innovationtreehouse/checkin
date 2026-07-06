-- a1 (HOUSEHOLD_LEAD_MODEL.md): collapse the HouseholdLead join table into a
-- single boolean on Person, killing the dual source of truth (Person.householdId
-- vs HouseholdLead.householdId). EXPAND phase — ADDITIVE ONLY: adds + backfills
-- the column and its index. The HouseholdLead table is retained (unused) and
-- dropped in the follow-up CONTRACT migration once this is fully rolled out, so
-- this stays safe on the LIVE DB (no data loss; drift check still matches).
--
-- Prisma does NOT wrap a migration file in a transaction on Postgres
-- (prisma/prisma#15295); these three statements must all land or none, so wrap
-- them explicitly (migration-safety.md step 4).
BEGIN;

-- Additive, NOT NULL with a default (safe on a populated table).
ALTER TABLE "Person" ADD COLUMN "isHouseholdLead" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: a person is a lead iff a HouseholdLead row ties them to THEIR OWN
-- household. The `hl."householdId" = p."householdId"` clause deliberately ignores
-- any divergent row (lead of a household they don't belong to). Such a row was
-- never honored as leadership by the gate (leads.ts:19 required the equality), so
-- it must not become a real lead now. ONE nuance: merge/route.ts treated ANY lead
-- row as a "don't merge away a lead with dependents" guard — a divergent-only row
-- loses that guard after cutover. Divergent rows are not expected in the live DB
-- (no write path creates them; see HOUSEHOLD_LEAD_MODEL.md §3), but confirm before
-- deploy: SELECT hl.* FROM "HouseholdLead" hl JOIN "Person" p ON hl."personId"=p."id"
-- WHERE hl."householdId" != p."householdId";  -- expect zero; decide per-row if not.
UPDATE "Person" p
SET "isHouseholdLead" = true
WHERE EXISTS (
    SELECT 1 FROM "HouseholdLead" hl
    WHERE hl."personId" = p."id"
      AND hl."householdId" = p."householdId"
);

-- Index household-lead lookups. Person had no index on householdId — the dropped
-- HouseholdLead join table's composite PK (householdId, personId) used to provide
-- one for free. Lead scans (`where householdId, isHouseholdLead: true`) run on hot
-- paths (check-in notification fan-out, nav badges, broken/unclaimed filters).
CREATE INDEX "Person_householdId_isHouseholdLead_idx" ON "Person"("householdId", "isHouseholdLead");

COMMIT;
