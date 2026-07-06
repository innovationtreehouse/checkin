-- Point-in-time snapshot of household org-membership status at scholarship/
-- payment-plan approval. Additive nullable column, no backfill, no data loss.
ALTER TABLE "ProgramParticipant" ADD COLUMN "wasOrgMemberAtApproval" BOOLEAN;
