-- Background check becomes a parallel (non-blocking) track in the membership
-- application flow. Adds the PENDING_BG_CLEARANCE status (paid, awaiting check)
-- and a bgClearedAt marker, then backfills existing rows so nothing regresses.

-- AlterEnum: new "paid, awaiting background check" holding status.
-- (Not used in this migration's data statements, so it is safe inside the
-- migration transaction on PostgreSQL 12+.)
ALTER TYPE "MembershipProcessStatus" ADD VALUE 'PENDING_BG_CLEARANCE';

-- AlterTable: single source of truth for "BG cleared this cycle".
ALTER TABLE "MembershipProcess" ADD COLUMN "bgClearedAt" TIMESTAMP(3);

-- Backfill 1: any process already at or past payment cleared its background
-- check under the old (sequential) ordering, so mark it cleared. Use the most
-- meaningful timestamp available.
UPDATE "MembershipProcess"
   SET "bgClearedAt" = COALESCE("paidAt", "stageEnteredAt", CURRENT_TIMESTAMP)
 WHERE "status" IN ('PENDING_PAYMENT', 'ACTIVE');

-- Backfill 2: in-flight INITIAL applications still in background review move to
-- PENDING_PAYMENT so they are unblocked immediately; their review continues in
-- parallel (bgClearedAt stays NULL until two reviewers approve). Renewal review
-- (RENEWAL_PENDING_BG) is intentionally left as-is.
UPDATE "MembershipProcess"
   SET "status" = 'PENDING_PAYMENT', "stageEnteredAt" = CURRENT_TIMESTAMP
 WHERE "status" = 'PENDING_BG_REVIEW';
