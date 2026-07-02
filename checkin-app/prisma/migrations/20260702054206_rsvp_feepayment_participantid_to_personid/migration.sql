/*
  Warnings:

  - The primary key for the `FeePayment` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `participantId` on the `FeePayment` table. All the data in the column will be lost.
  - The primary key for the `RSVP` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `participantId` on the `RSVP` table. All the data in the column will be lost.
  - Added the required column `personId` to the `FeePayment` table without a default value. This is not possible if the table is not empty.
  - Added the required column `personId` to the `RSVP` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "FeePayment" DROP CONSTRAINT "FeePayment_participantId_fkey";

-- DropForeignKey
ALTER TABLE "RSVP" DROP CONSTRAINT "RSVP_participantId_fkey";

-- AlterTable
ALTER TABLE "FeePayment" DROP CONSTRAINT "FeePayment_pkey",
DROP COLUMN "participantId",
ADD COLUMN     "personId" INTEGER NOT NULL,
ADD CONSTRAINT "FeePayment_pkey" PRIMARY KEY ("feeId", "personId");

-- AlterTable
ALTER TABLE "RSVP" DROP CONSTRAINT "RSVP_pkey",
DROP COLUMN "participantId",
ADD COLUMN     "personId" INTEGER NOT NULL,
ADD CONSTRAINT "RSVP_pkey" PRIMARY KEY ("eventId", "personId");

-- AddForeignKey
ALTER TABLE "FeePayment" ADD CONSTRAINT "FeePayment_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Participant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RSVP" ADD CONSTRAINT "RSVP_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Participant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
