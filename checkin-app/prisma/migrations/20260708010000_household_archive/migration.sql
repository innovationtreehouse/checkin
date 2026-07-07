-- Additive, nullable: soft-archive stamp for a household (family).
-- Non-null == archived (set aside): hidden from default board lists, skipped in
-- crons/fan-outs, members blocked from new activity. History untouched; clearing
-- it restores everything. No backfill (nullable). See
-- docs/designs/HOUSEHOLD_ARCHIVE.md.
ALTER TABLE "Household" ADD COLUMN "archivedAt" TIMESTAMP(3);
