-- CreateEnum
CREATE TYPE "TrustedAdultOrigin" AS ENUM ('SELF_DISCLOSED', 'STAFF_ENTERED');

-- CreateEnum
CREATE TYPE "TrustedAdultReviewKind" AS ENUM ('INITIAL', 'RENEWAL');

-- CreateEnum
CREATE TYPE "TrustedAdultReviewStatus" AS ENUM ('PENDING_BOARD_REVIEW', 'PENDING_SUBJECT_ACTION', 'APPROVED', 'DENIED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "TrustedAdultDecisionKind" AS ENUM ('APPROVE', 'DENY', 'REQUEST_INFO');

-- CreateTable
CREATE TABLE "TrustedAdult" (
    "id" SERIAL NOT NULL,
    "householdId" INTEGER NOT NULL,
    "counterpartyParticipantId" INTEGER,
    "counterpartyName" TEXT NOT NULL,
    "counterpartyContact" TEXT NOT NULL,
    "familyContext" TEXT NOT NULL,
    "origin" "TrustedAdultOrigin" NOT NULL DEFAULT 'SELF_DISCLOSED',
    "disclosedById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrustedAdult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustedAdultReview" (
    "id" SERIAL NOT NULL,
    "trustedAdultId" INTEGER NOT NULL,
    "householdId" INTEGER NOT NULL,
    "kind" "TrustedAdultReviewKind" NOT NULL,
    "status" "TrustedAdultReviewStatus" NOT NULL DEFAULT 'PENDING_BOARD_REVIEW',
    "decidedById" INTEGER,
    "decision" "TrustedAdultDecisionKind",
    "decisionNote" TEXT,
    "sharedNote" TEXT,
    "effectiveFrom" TIMESTAMP(3),
    "reviewBy" TIMESTAMP(3),
    "expiryWarningSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrustedAdultReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrustedAdult_householdId_idx" ON "TrustedAdult"("householdId");

-- CreateIndex
CREATE INDEX "TrustedAdultReview_trustedAdultId_idx" ON "TrustedAdultReview"("trustedAdultId");

-- CreateIndex
CREATE INDEX "TrustedAdultReview_status_idx" ON "TrustedAdultReview"("status");

-- CreateIndex
CREATE INDEX "TrustedAdultReview_householdId_idx" ON "TrustedAdultReview"("householdId");

-- AddForeignKey
ALTER TABLE "TrustedAdult" ADD CONSTRAINT "TrustedAdult_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustedAdult" ADD CONSTRAINT "TrustedAdult_counterpartyParticipantId_fkey" FOREIGN KEY ("counterpartyParticipantId") REFERENCES "Participant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustedAdult" ADD CONSTRAINT "TrustedAdult_disclosedById_fkey" FOREIGN KEY ("disclosedById") REFERENCES "Participant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustedAdultReview" ADD CONSTRAINT "TrustedAdultReview_trustedAdultId_fkey" FOREIGN KEY ("trustedAdultId") REFERENCES "TrustedAdult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustedAdultReview" ADD CONSTRAINT "TrustedAdultReview_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "Participant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
