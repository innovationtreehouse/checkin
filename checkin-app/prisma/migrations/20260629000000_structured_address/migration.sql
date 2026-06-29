-- Structured address: replace free-text `address` with line1/line2/city/state/postalCode
-- on Household and Corporation.

-- AlterTable: Household
ALTER TABLE "Household" ADD COLUMN "line1" TEXT;
ALTER TABLE "Household" ADD COLUMN "line2" TEXT;
ALTER TABLE "Household" ADD COLUMN "city" TEXT;
ALTER TABLE "Household" ADD COLUMN "state" TEXT;
ALTER TABLE "Household" ADD COLUMN "postalCode" TEXT;

-- AlterTable: Corporation
ALTER TABLE "Corporation" ADD COLUMN "line1" TEXT;
ALTER TABLE "Corporation" ADD COLUMN "line2" TEXT;
ALTER TABLE "Corporation" ADD COLUMN "city" TEXT;
ALTER TABLE "Corporation" ADD COLUMN "state" TEXT;
ALTER TABLE "Corporation" ADD COLUMN "postalCode" TEXT;

-- Backfill: old free-text address moves verbatim into line1. Parsing arbitrary
-- free text into components is unreliable; an honest single line beats a wrong split.
-- Members re-enter structured fields on next edit.
UPDATE "Household" SET "line1" = "address" WHERE "address" IS NOT NULL;
UPDATE "Corporation" SET "line1" = "address" WHERE "address" IS NOT NULL;

ALTER TABLE "Household" DROP COLUMN "address";
ALTER TABLE "Corporation" DROP COLUMN "address";
