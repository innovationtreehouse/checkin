-- Additive, nullable: the "Anything else we should know?" intake note.
-- Optional freeform text, never a submit gate; no backfill needed (nullable).
ALTER TABLE "Household" ADD COLUMN "intakeNotes" TEXT;
