-- Data-preserving column renames (Participant role booleans -> is* convention).
-- RENAME COLUMN keeps existing values; Prisma would otherwise drop+add and lose data.
ALTER TABLE "Participant" RENAME COLUMN "sysadmin" TO "isSysadmin";
ALTER TABLE "Participant" RENAME COLUMN "boardMember" TO "isBoardMember";
ALTER TABLE "Participant" RENAME COLUMN "keyholder" TO "isKeyholder";
ALTER TABLE "Participant" RENAME COLUMN "backgroundCheckReviewer" TO "isBackgroundCheckReviewer";
