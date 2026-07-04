-- Resubmission that CHANGES a trusted adult's facts, without disturbing a live prior approval.
-- The new enum value is not referenced in this same migration, so ADD VALUE is safe here.
ALTER TYPE "public"."TrustedAdultReviewKind" ADD VALUE 'MODIFIED';

-- Proposed edits ride on the review and promote onto the parent only on approval.
ALTER TABLE "public"."TrustedAdultReview"
    ADD COLUMN "proposedName" TEXT,
    ADD COLUMN "proposedPhone" TEXT,
    ADD COLUMN "proposedEmail" TEXT,
    ADD COLUMN "proposedContext" TEXT;
