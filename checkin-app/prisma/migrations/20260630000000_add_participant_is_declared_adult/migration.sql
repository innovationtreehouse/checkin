-- Marks a member as 25+ when no DoB is on file, so the household UI can show
-- "Adult" instead of "Age Unavailable".
ALTER TABLE "Participant" ADD COLUMN "isDeclaredAdult" BOOLEAN NOT NULL DEFAULT false;
