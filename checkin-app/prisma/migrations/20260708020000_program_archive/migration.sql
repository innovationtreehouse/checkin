-- Additive, nullable: soft-archive for programs (board/sysadmin decision to
-- retire a program from active surfaces and freeze new activity on it). NULL =
-- not archived, so every existing row keeps its current behavior untouched. No
-- backfill, no index; orthogonal to Program.phase. See
-- docs/designs/PROGRAM_ARCHIVE.md.
ALTER TABLE "Program" ADD COLUMN "archivedAt" TIMESTAMP(3);
