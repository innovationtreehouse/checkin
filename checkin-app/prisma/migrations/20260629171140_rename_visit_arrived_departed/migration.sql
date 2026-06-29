-- Rename Visit.arrived -> arrivedAt and Visit.departed -> departedAt.
-- Hand-edited from Prisma's default DROP/ADD to RENAME COLUMN so existing
-- visit data is preserved. The index holds no data, so dropping/recreating it is fine.

-- DropIndex
DROP INDEX "Visit_participantId_departed_idx";

-- AlterTable
ALTER TABLE "Visit" RENAME COLUMN "arrived" TO "arrivedAt";
ALTER TABLE "Visit" RENAME COLUMN "departed" TO "departedAt";

-- CreateIndex
CREATE INDEX "Visit_participantId_departedAt_idx" ON "Visit"("participantId", "departedAt");
