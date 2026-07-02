/*
  Warnings:

  - The primary key for the `CorporationLead` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `participantId` on the `CorporationLead` table. All the data in the column will be lost.
  - The primary key for the `CorporationMember` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `participantId` on the `CorporationMember` table. All the data in the column will be lost.
  - Added the required column `personId` to the `CorporationLead` table without a default value. This is not possible if the table is not empty.
  - Added the required column `personId` to the `CorporationMember` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "CorporationLead" DROP CONSTRAINT "CorporationLead_participantId_fkey";

-- DropForeignKey
ALTER TABLE "CorporationMember" DROP CONSTRAINT "CorporationMember_participantId_fkey";

-- AlterTable
ALTER TABLE "CorporationLead" DROP CONSTRAINT "CorporationLead_pkey",
DROP COLUMN "participantId",
ADD COLUMN     "personId" INTEGER NOT NULL,
ADD CONSTRAINT "CorporationLead_pkey" PRIMARY KEY ("corporationId", "personId");

-- AlterTable
ALTER TABLE "CorporationMember" DROP CONSTRAINT "CorporationMember_pkey",
DROP COLUMN "participantId",
ADD COLUMN     "personId" INTEGER NOT NULL,
ADD CONSTRAINT "CorporationMember_pkey" PRIMARY KEY ("corporationId", "personId");

-- AddForeignKey
ALTER TABLE "CorporationLead" ADD CONSTRAINT "CorporationLead_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Participant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporationMember" ADD CONSTRAINT "CorporationMember_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Participant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
