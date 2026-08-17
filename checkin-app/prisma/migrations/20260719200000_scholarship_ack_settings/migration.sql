-- Additive + nullable, no backfill. Configurable subject/bodies for the
-- scholarship / payment-plan request ACK (the applicant's only automatic
-- email — see scholarshipEmails.ts). NULL/blank falls back to the default
-- copy defined in lib/scholarshipEmails.ts.
ALTER TABLE "BoardSettings" ADD COLUMN     "scholarshipAckMembershipBody" TEXT,
ADD COLUMN     "scholarshipAckProgramBody" TEXT,
ADD COLUMN     "scholarshipAckSubject" TEXT;
