-- Data-preserving column renames (boolean fields -> is* convention).
-- RENAME COLUMN keeps existing values; Prisma would otherwise drop+add and lose data.
ALTER TABLE "ProgramParticipant" RENAME COLUMN "paymentPlanRequested" TO "isPaymentPlanRequested";
ALTER TABLE "BackgroundCheckAttestation" RENAME COLUMN "markedVolunteer" TO "isMarkedVolunteer";
