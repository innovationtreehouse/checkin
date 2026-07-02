/*
  Warnings:

  - You are about to drop the column `participantId` on the `RawBadgeLog` table. All the data in the column will be lost.
  - Added the required column `personId` to the `RawBadgeLog` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "RawBadgeLog" DROP CONSTRAINT "RawBadgeLog_participantId_fkey";

-- DropIndex
DROP INDEX "RawBadgeLog_participantId_timestamp_idx";

-- AlterTable
ALTER TABLE "RawBadgeLog" DROP COLUMN "participantId",
ADD COLUMN     "personId" INTEGER NOT NULL;

-- CreateIndex
CREATE INDEX "RawBadgeLog_personId_timestamp_idx" ON "RawBadgeLog"("personId", "timestamp");

-- AddForeignKey
ALTER TABLE "RawBadgeLog" ADD CONSTRAINT "RawBadgeLog_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Participant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
