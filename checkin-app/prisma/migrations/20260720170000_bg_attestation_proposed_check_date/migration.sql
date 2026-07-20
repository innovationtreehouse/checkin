-- The check-completion date a reviewer attests to, when they backdate the check
-- via the review UI. Null (the default for every existing row) = "as of today",
-- i.e. the check is stamped at clearance time — the pre-feature behavior. Purely
-- additive: a nullable column with no default and no backfill.
ALTER TABLE "BackgroundCheckAttestation" ADD COLUMN "proposedCheckDate" TIMESTAMP(3);
