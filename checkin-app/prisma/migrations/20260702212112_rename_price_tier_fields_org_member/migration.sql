/*
  Warnings:

  - You are about to drop the column `memberPriceCents` on the `Fee` table. All the data in the column will be lost.
  - You are about to drop the column `nonMemberPriceCents` on the `Fee` table. All the data in the column will be lost.
  - You are about to drop the column `memberOnly` on the `Program` table. All the data in the column will be lost.
  - You are about to drop the column `memberPriceCents` on the `Program` table. All the data in the column will be lost.
  - You are about to drop the column `nonMemberPriceCents` on the `Program` table. All the data in the column will be lost.
  - You are about to drop the column `shopifyMemberVariantId` on the `Program` table. All the data in the column will be lost.
  - You are about to drop the column `shopifyNonMemberVariantId` on the `Program` table. All the data in the column will be lost.
  - Added the required column `nonOrgMemberPriceCents` to the `Fee` table without a default value. This is not possible if the table is not empty.
  - Added the required column `orgMemberPriceCents` to the `Fee` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Fee" DROP COLUMN "memberPriceCents",
DROP COLUMN "nonMemberPriceCents",
ADD COLUMN     "nonOrgMemberPriceCents" INTEGER NOT NULL,
ADD COLUMN     "orgMemberPriceCents" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "Program" DROP COLUMN "memberOnly",
DROP COLUMN "memberPriceCents",
DROP COLUMN "nonMemberPriceCents",
DROP COLUMN "shopifyMemberVariantId",
DROP COLUMN "shopifyNonMemberVariantId",
ADD COLUMN     "nonOrgMemberPriceCents" INTEGER,
ADD COLUMN     "orgMemberOnly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "orgMemberPriceCents" INTEGER,
ADD COLUMN     "shopifyNonOrgMemberVariantId" TEXT,
ADD COLUMN     "shopifyOrgMemberVariantId" TEXT;
