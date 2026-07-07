-- Additive, nullable: the Google Group address a program's active participants
-- are synced into (self + household-lead emails). Null = no group configured;
-- sync is a no-op for that program. Board-set on program-ops, validated as an
-- email in the app. See docs/designs/PROGRAM_GOOGLE_GROUP_SYNC.md.
ALTER TABLE "Program" ADD COLUMN "googleGroupEmail" TEXT;
