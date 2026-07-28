-- Additive, nullable: once-per-lifetime announce marker. NULL = never announced;
-- existing rows stay NULL and simply won't re-announce (they already fired or never will).
ALTER TABLE "Program" ADD COLUMN "announcedAt" TIMESTAMP(3);
