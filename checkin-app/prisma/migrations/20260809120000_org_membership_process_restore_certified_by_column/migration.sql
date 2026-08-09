-- Puts the column back on its original name. The Prisma field stays
-- `manualPaymentById` and reaches it through @map, so the previous release —
-- which serves traffic against this schema for the whole rolling-deploy drain
-- window — keeps reading OrgMembershipProcess (rule 3).
ALTER TABLE "OrgMembershipProcess" RENAME COLUMN "manualPaymentById" TO "certifiedById";
