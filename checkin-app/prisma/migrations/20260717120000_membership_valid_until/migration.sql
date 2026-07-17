-- Org-wide "current membership applications are valid until" date shown in the
-- membership-ops views. Additive + nullable — no backfill, no destructive change.
ALTER TABLE "BoardSettings" ADD COLUMN "currentMembershipValidUntil" TIMESTAMP(3);
