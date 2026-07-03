-- Rename table Participant -> Person (A2, atomic — no column changes). Use RENAME
-- (not Prisma's default DROP TABLE + CREATE TABLE, which would destroy every person
-- row; on a populated DB the FK re-adds fail anyway and wedge migrate deploy).
-- Child FK constraints follow the renamed table automatically (they bind to the
-- table, not its name), and they already carry their post-A1 *_personId_fkey names.
ALTER TABLE "Participant" RENAME TO "Person";

-- Keep the table's own constraint/index names in sync with Prisma's expectations.
ALTER TABLE "Person" RENAME CONSTRAINT "Participant_pkey" TO "Person_pkey";
ALTER INDEX "Participant_googleId_key" RENAME TO "Person_googleId_key";
ALTER INDEX "Participant_email_key" RENAME TO "Person_email_key";
ALTER TABLE "Person" RENAME CONSTRAINT "Participant_householdId_fkey" TO "Person_householdId_fkey";

-- Note: the id serial sequence keeps its old name ("Participant_id_seq") — cosmetic;
-- Prisma binds via the column default (same reasoning as the index note in
-- 20260702053421_visit_participantid_to_personid).
