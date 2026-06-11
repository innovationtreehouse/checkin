-- CreateEnum
CREATE TYPE "ProgramParticipantStatus" AS ENUM ('PENDING', 'ACTIVE');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('NONE', 'ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "MembershipProcessKind" AS ENUM ('INITIAL', 'RENEWAL');

-- CreateEnum
CREATE TYPE "MembershipProcessStatus" AS ENUM ('INTAKE', 'PENDING_EXTERNAL_ACTION', 'PENDING_BG_REVIEW', 'PENDING_PAYMENT', 'ACTIVE', 'BLOCKED', 'PENDING_RENEWAL', 'RENEWAL_PENDING_BG');

-- CreateEnum
CREATE TYPE "AttestationResult" AS ENUM ('APPROVE', 'REJECT');

-- DropForeignKey
ALTER TABLE "Membership" DROP CONSTRAINT "Membership_corporateId_fkey";

-- DropForeignKey
ALTER TABLE "Membership" DROP CONSTRAINT "Membership_householdId_fkey";

-- DropForeignKey
ALTER TABLE "Membership" DROP CONSTRAINT "Membership_volunteerId_fkey";

-- AlterTable
ALTER TABLE "Membership" DROP COLUMN "active",
DROP COLUMN "corporateId",
DROP COLUMN "latestDocusign",
DROP COLUMN "latestShopifyReceipt",
DROP COLUMN "type",
DROP COLUMN "volunteerId",
ADD COLUMN     "isVolunteer" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "status" "MembershipStatus" NOT NULL DEFAULT 'NONE',
ALTER COLUMN "householdId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Participant" ADD COLUMN     "allergies" TEXT,
ADD COLUMN     "backgroundCheckReviewer" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Program" ADD COLUMN     "memberPrice" INTEGER,
ADD COLUMN     "nonMemberPrice" INTEGER,
ADD COLUMN     "shopifyMemberVariantId" TEXT,
ADD COLUMN     "shopifyNonMemberVariantId" TEXT,
ADD COLUMN     "shopifyProductId" TEXT;

-- AlterTable
ALTER TABLE "ProgramParticipant" ADD COLUMN     "paymentPlanRequested" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pendingSince" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "status" "ProgramParticipantStatus" NOT NULL DEFAULT 'PENDING';

-- DropEnum
DROP TYPE "MembershipType";

-- CreateTable
CREATE TABLE "MembershipProcess" (
    "id" SERIAL NOT NULL,
    "membershipId" INTEGER NOT NULL,
    "kind" "MembershipProcessKind" NOT NULL,
    "status" "MembershipProcessStatus" NOT NULL,
    "stageEnteredAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "zohoEnvelopeId" TEXT,
    "contractSignedAt" TIMESTAMP(3),
    "bgConsentAt" TIMESTAMP(3),
    "shopifyDraftOrderId" TEXT,
    "shopifyInvoiceUrl" TEXT,
    "shopifyOrderId" TEXT,
    "paidAt" TIMESTAMP(3),
    "certifiedById" INTEGER,
    "renewalReminderSentAt" TIMESTAMP(3),

    CONSTRAINT "MembershipProcess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackgroundCheckAttestation" (
    "id" SERIAL NOT NULL,
    "processId" INTEGER NOT NULL,
    "reviewerId" INTEGER NOT NULL,
    "result" "AttestationResult" NOT NULL,
    "markedVolunteer" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackgroundCheckAttestation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VolunteerDesignation" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VolunteerDesignation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "normalDuesCents" INTEGER NOT NULL DEFAULT 0,
    "volunteerDuesCents" INTEGER NOT NULL DEFAULT 0,
    "membershipYearBoundary" TIMESTAMP(3),
    "shopifyMembershipProductId" TEXT,
    "shopifyNormalVariantId" TEXT,
    "shopifyVolunteerVariantId" TEXT,
    "shopifyPriceSyncedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoardSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemMetric" (
    "id" SERIAL NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "SystemMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MembershipProcess_membershipId_idx" ON "MembershipProcess"("membershipId");

-- CreateIndex
CREATE INDEX "MembershipProcess_status_idx" ON "MembershipProcess"("status");

-- CreateIndex
CREATE UNIQUE INDEX "BackgroundCheckAttestation_processId_reviewerId_key" ON "BackgroundCheckAttestation"("processId", "reviewerId");

-- CreateIndex
CREATE UNIQUE INDEX "VolunteerDesignation_email_key" ON "VolunteerDesignation"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_householdId_key" ON "Membership"("householdId");

-- CreateIndex
CREATE INDEX "Membership_status_idx" ON "Membership"("status");

-- CreateIndex
CREATE INDEX "RawBadgeEvent_participantId_time_idx" ON "RawBadgeEvent"("participantId", "time");

-- CreateIndex
CREATE INDEX "Visit_participantId_departed_idx" ON "Visit"("participantId", "departed");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipProcess" ADD CONSTRAINT "MembershipProcess_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackgroundCheckAttestation" ADD CONSTRAINT "BackgroundCheckAttestation_processId_fkey" FOREIGN KEY ("processId") REFERENCES "MembershipProcess"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackgroundCheckAttestation" ADD CONSTRAINT "BackgroundCheckAttestation_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "Participant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Program" ADD CONSTRAINT "Program_leadMentorId_fkey" FOREIGN KEY ("leadMentorId") REFERENCES "Participant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

