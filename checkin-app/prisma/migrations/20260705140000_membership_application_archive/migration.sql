-- Board disposal of abandoned membership applications. Additive nullable columns —
-- no backfill, no data loss on the live table.
ALTER TABLE "OrgMembershipProcess" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "OrgMembershipProcess" ADD COLUMN "archivedById" INTEGER;

-- Archived (disposed) processes are terminal: they must NOT occupy the
-- "one in-flight INITIAL per membership" slot, so a returning applicant can file
-- a fresh application. Recreate the partial unique index with archivedAt IS NULL.
-- Index-only change (no data touched); WHERE is written out in full because
-- prisma migrate diff drops partial predicates.
DROP INDEX "membership_one_inflight_initial";
CREATE UNIQUE INDEX "membership_one_inflight_initial" ON "OrgMembershipProcess" ("orgMembershipId")
    WHERE "kind" = 'INITIAL'
      AND "archivedAt" IS NULL
      AND "status" IN ('INTAKE', 'PENDING_EXTERNAL_ACTION', 'PENDING_BG_REVIEW', 'PENDING_PAYMENT', 'PENDING_BG_CLEARANCE');
