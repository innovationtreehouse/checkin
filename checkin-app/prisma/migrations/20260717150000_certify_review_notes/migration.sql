-- Recorded justifications for board actions: certification reason and
-- background-check review notes. Additive + nullable — no backfill.
ALTER TABLE "OrgMembershipProcess" ADD COLUMN "certificationNote" TEXT;
ALTER TABLE "BackgroundCheckAttestation" ADD COLUMN "note" TEXT;
