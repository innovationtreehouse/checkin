-- Additive + nullable, no backfill. The "Scholarship Review Team" notify address;
-- NULL falls back to emailing all board members.
ALTER TABLE "BoardSettings" ADD COLUMN "scholarshipNotifyEmail" TEXT;
