-- Rename time columns to the *At convention. Data-preserving RENAME (NOT drop/add).
-- Program.begin -> startAt, Program.end -> endAt
-- Event.start   -> startAt, Event.end -> endAt

-- AlterTable
ALTER TABLE "Event" RENAME COLUMN "start" TO "startAt";
ALTER TABLE "Event" RENAME COLUMN "end" TO "endAt";

-- AlterTable
ALTER TABLE "Program" RENAME COLUMN "begin" TO "startAt";
ALTER TABLE "Program" RENAME COLUMN "end" TO "endAt";
