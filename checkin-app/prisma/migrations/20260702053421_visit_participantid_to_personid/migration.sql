-- Rename Visit FK column participantId -> personId (Phase A1a of Participant->Person).
-- Use RENAME (not Prisma's default DROP+ADD) to preserve data AND the raw-SQL
-- partial unique index "Visit_one_open_per_participant" (the double-checkin backstop
-- from 20260629180000), which a DROP COLUMN would silently cascade away.
ALTER TABLE "Visit" RENAME COLUMN "participantId" TO "personId";

-- Keep index + FK constraint names in sync with Prisma's expectations.
ALTER INDEX "Visit_participantId_departedAt_idx" RENAME TO "Visit_personId_departedAt_idx";
ALTER TABLE "Visit" RENAME CONSTRAINT "Visit_participantId_fkey" TO "Visit_personId_fkey";

-- Note: partial unique index "Visit_one_open_per_participant" now references the
-- renamed column automatically; its name is cosmetic and left as-is.
