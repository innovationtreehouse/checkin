-- CreateEnum
CREATE TYPE "VisitSource" AS ENUM ('SCANNER', 'WEB', 'SYSTEM');

-- AlterTable
ALTER TABLE "Visit" ADD COLUMN     "arrivedVia" "VisitSource",
ADD COLUMN     "departedVia" "VisitSource";
