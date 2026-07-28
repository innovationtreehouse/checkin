-- Additive, NOT NULL with a default so existing rows backfill to false (#1153 opt-in).
ALTER TABLE "Program" ADD COLUMN "announceOnOpen" BOOLEAN NOT NULL DEFAULT false;
