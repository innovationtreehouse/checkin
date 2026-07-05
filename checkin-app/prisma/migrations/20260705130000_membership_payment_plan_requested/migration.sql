-- Household-requestable payment plan for MEMBERSHIP dues. Additive boolean with a
-- default — no backfill, no data loss on the live table.
ALTER TABLE "OrgMembershipProcess" ADD COLUMN "isPaymentPlanRequested" BOOLEAN NOT NULL DEFAULT false;
