-- Additive, nullable: the scholarship hold-ledger (product decision
-- 2026-07-06, supersedes this PR's earlier deny-time +1). ProgramParticipant
-- gets two timestamps tracking the -1/+1 lifecycle; BoardSettings gets the
-- opt-in grace-period length for the expiry sweep. No existing row is
-- touched — every column defaults to NULL, which is exactly "no hold" / "not
-- denied" / "expiry feature off".
ALTER TABLE "ProgramParticipant" ADD COLUMN "inventoryHeldAt" TIMESTAMP(3);
ALTER TABLE "ProgramParticipant" ADD COLUMN "paymentPlanDeniedAt" TIMESTAMP(3);
ALTER TABLE "BoardSettings" ADD COLUMN "scholarshipDenialGraceDays" INTEGER;
