-- Phase 2: per-person background-check obligation (PERSON_BG). Additive only —
-- no backfill, no data loss on the live table.

-- New process kind. Not referenced elsewhere in this migration, so ADD VALUE is safe.
ALTER TYPE "OrgMembershipProcessKind" ADD VALUE 'PERSON_BG';

-- A PERSON_BG process is not tied to a household membership; existing INITIAL/
-- RENEWAL rows keep their (non-null) orgMembershipId, so dropping NOT NULL loses
-- nothing.
ALTER TABLE "OrgMembershipProcess" ALTER COLUMN "orgMembershipId" DROP NOT NULL;

-- The person being checked (null for household INITIAL/RENEWAL).
ALTER TABLE "OrgMembershipProcess" ADD COLUMN "subjectPersonId" INTEGER;

ALTER TABLE "OrgMembershipProcess"
    ADD CONSTRAINT "OrgMembershipProcess_subjectPersonId_fkey"
    FOREIGN KEY ("subjectPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
