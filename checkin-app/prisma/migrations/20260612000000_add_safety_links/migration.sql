-- CreateEnum
CREATE TYPE "SafetyLinkRelationshipType" AS ENUM ('FAMILY', 'GUARDIAN', 'HOUSEHOLD', 'ROMANTIC', 'FORMER_PROFESSIONAL', 'FINANCIAL', 'LEGAL_RESTRICTION', 'OTHER');

-- CreateEnum
CREATE TYPE "SafetyLinkOrigin" AS ENUM ('SELF_DISCLOSED', 'STAFF_ENTERED');

-- CreateEnum
CREATE TYPE "SafetyLinkReviewKind" AS ENUM ('INITIAL', 'RENEWAL');

-- CreateEnum
CREATE TYPE "SafetyLinkReviewStatus" AS ENUM ('PENDING_BOARD_REVIEW', 'PENDING_SUBJECT_ACTION', 'APPROVED', 'APPROVED_WITH_CONDITIONS', 'DENIED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "SafetyLinkDecisionKind" AS ENUM ('APPROVE', 'APPROVE_WITH_CONDITIONS', 'DENY', 'REQUEST_INFO');

-- CreateTable
CREATE TABLE "SafetyLink" (
    "id" SERIAL NOT NULL,
    "subjectParticipantId" INTEGER NOT NULL,
    "counterpartyParticipantId" INTEGER,
    "counterpartyName" TEXT,
    "counterpartyContact" TEXT,
    "relationshipType" "SafetyLinkRelationshipType" NOT NULL,
    "description" TEXT NOT NULL,
    "origin" "SafetyLinkOrigin" NOT NULL DEFAULT 'SELF_DISCLOSED',
    "disclosedById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SafetyLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyLinkReview" (
    "id" SERIAL NOT NULL,
    "safetyLinkId" INTEGER NOT NULL,
    "subjectParticipantId" INTEGER NOT NULL,
    "kind" "SafetyLinkReviewKind" NOT NULL,
    "status" "SafetyLinkReviewStatus" NOT NULL DEFAULT 'PENDING_BOARD_REVIEW',
    "decidedById" INTEGER,
    "decision" "SafetyLinkDecisionKind",
    "decisionNote" TEXT,
    "conditions" TEXT,
    "effectiveFrom" TIMESTAMP(3),
    "reviewBy" TIMESTAMP(3),
    "warnedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SafetyLinkReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SafetyLink_subjectParticipantId_idx" ON "SafetyLink"("subjectParticipantId");

-- CreateIndex
CREATE INDEX "SafetyLinkReview_safetyLinkId_idx" ON "SafetyLinkReview"("safetyLinkId");

-- CreateIndex
CREATE INDEX "SafetyLinkReview_status_idx" ON "SafetyLinkReview"("status");

-- CreateIndex
CREATE INDEX "SafetyLinkReview_subjectParticipantId_idx" ON "SafetyLinkReview"("subjectParticipantId");

-- AddForeignKey
ALTER TABLE "SafetyLink" ADD CONSTRAINT "SafetyLink_subjectParticipantId_fkey" FOREIGN KEY ("subjectParticipantId") REFERENCES "Participant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyLink" ADD CONSTRAINT "SafetyLink_counterpartyParticipantId_fkey" FOREIGN KEY ("counterpartyParticipantId") REFERENCES "Participant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyLink" ADD CONSTRAINT "SafetyLink_disclosedById_fkey" FOREIGN KEY ("disclosedById") REFERENCES "Participant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyLinkReview" ADD CONSTRAINT "SafetyLinkReview_safetyLinkId_fkey" FOREIGN KEY ("safetyLinkId") REFERENCES "SafetyLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyLinkReview" ADD CONSTRAINT "SafetyLinkReview_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "Participant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
