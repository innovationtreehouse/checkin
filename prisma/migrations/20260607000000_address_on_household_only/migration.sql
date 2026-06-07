-- Address lives on Household only; every Participant must belong to a Household.

-- 1. Backfill: create a single-person household for every orphaned participant.
--    A temp column on Household carries the participant id so each new row can
--    be linked back unambiguously (names are not unique).
ALTER TABLE "Household" ADD COLUMN "tmp_backfill_participant_id" INTEGER;

INSERT INTO "Household" ("name", "tmp_backfill_participant_id")
SELECT COALESCE(p."name", 'Participant ' || p."id"), p."id"
FROM "Participant" p
WHERE p."householdId" IS NULL;

UPDATE "Participant" p
SET "householdId" = h."id"
FROM "Household" h
WHERE h."tmp_backfill_participant_id" = p."id";

-- Each backfilled participant leads their own household, so they can edit
-- household settings (including the address).
INSERT INTO "HouseholdLead" ("householdId", "participantId")
SELECT h."id", h."tmp_backfill_participant_id"
FROM "Household" h
WHERE h."tmp_backfill_participant_id" IS NOT NULL;

ALTER TABLE "Household" DROP COLUMN "tmp_backfill_participant_id";

-- 2. Drop the participant-level address. Existing values are intentionally
--    discarded (decision 2026-06-07): Household.address is the only address.
ALTER TABLE "Participant" DROP COLUMN "homeAddress";

-- 3. Require household membership. Deleting a household is now blocked
--    (RESTRICT) while it still has participants; participants are tombstoned,
--    never deleted.
ALTER TABLE "Participant" ALTER COLUMN "householdId" SET NOT NULL;

ALTER TABLE "Participant" DROP CONSTRAINT "Participant_householdId_fkey";
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_householdId_fkey"
  FOREIGN KEY ("householdId") REFERENCES "Household"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
