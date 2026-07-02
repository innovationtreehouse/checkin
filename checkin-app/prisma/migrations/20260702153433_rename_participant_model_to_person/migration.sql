/*
  Warnings:

  - You are about to drop the `Participant` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Account" DROP CONSTRAINT "Account_participant_id_fkey";

-- DropForeignKey
ALTER TABLE "BackgroundCheckAttestation" DROP CONSTRAINT "BackgroundCheckAttestation_reviewerId_fkey";

-- DropForeignKey
ALTER TABLE "CorporationLead" DROP CONSTRAINT "CorporationLead_personId_fkey";

-- DropForeignKey
ALTER TABLE "CorporationMember" DROP CONSTRAINT "CorporationMember_personId_fkey";

-- DropForeignKey
ALTER TABLE "Event" DROP CONSTRAINT "Event_attendanceConfirmedById_fkey";

-- DropForeignKey
ALTER TABLE "FeePayment" DROP CONSTRAINT "FeePayment_personId_fkey";

-- DropForeignKey
ALTER TABLE "HouseholdLead" DROP CONSTRAINT "HouseholdLead_personId_fkey";

-- DropForeignKey
ALTER TABLE "Participant" DROP CONSTRAINT "Participant_householdId_fkey";

-- DropForeignKey
ALTER TABLE "Program" DROP CONSTRAINT "Program_leadMentorId_fkey";

-- DropForeignKey
ALTER TABLE "ProgramParticipant" DROP CONSTRAINT "ProgramParticipant_personId_fkey";

-- DropForeignKey
ALTER TABLE "ProgramVolunteer" DROP CONSTRAINT "ProgramVolunteer_personId_fkey";

-- DropForeignKey
ALTER TABLE "RSVP" DROP CONSTRAINT "RSVP_personId_fkey";

-- DropForeignKey
ALTER TABLE "RawBadgeLog" DROP CONSTRAINT "RawBadgeLog_personId_fkey";

-- DropForeignKey
ALTER TABLE "Session" DROP CONSTRAINT "Session_participant_id_fkey";

-- DropForeignKey
ALTER TABLE "ToolStatus" DROP CONSTRAINT "ToolStatus_personId_fkey";

-- DropForeignKey
ALTER TABLE "TrustedAdult" DROP CONSTRAINT "TrustedAdult_counterpartyParticipantId_fkey";

-- DropForeignKey
ALTER TABLE "TrustedAdult" DROP CONSTRAINT "TrustedAdult_disclosedById_fkey";

-- DropForeignKey
ALTER TABLE "TrustedAdultReview" DROP CONSTRAINT "TrustedAdultReview_decidedById_fkey";

-- DropForeignKey
ALTER TABLE "Visit" DROP CONSTRAINT "Visit_personId_fkey";

-- DropTable
DROP TABLE "Participant";

-- CreateTable
CREATE TABLE "Person" (
    "id" SERIAL NOT NULL,
    "googleId" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "name" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "isDeclaredAdult" BOOLEAN NOT NULL DEFAULT false,
    "lastWaiverSign" TIMESTAMP(3),
    "waiverSignedBy" INTEGER,
    "lastBackgroundCheck" TIMESTAMP(3),
    "notificationSettings" JSONB,
    "householdId" INTEGER NOT NULL,
    "allergies" TEXT,
    "isSysadmin" BOOLEAN NOT NULL DEFAULT false,
    "isBoardMember" BOOLEAN NOT NULL DEFAULT false,
    "isKeyholder" BOOLEAN NOT NULL DEFAULT false,
    "isBackgroundCheckReviewer" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Person_googleId_key" ON "Person"("googleId");

-- CreateIndex
CREATE UNIQUE INDEX "Person_email_key" ON "Person"("email");

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolStatus" ADD CONSTRAINT "ToolStatus_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseholdLead" ADD CONSTRAINT "HouseholdLead_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackgroundCheckAttestation" ADD CONSTRAINT "BackgroundCheckAttestation_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustedAdult" ADD CONSTRAINT "TrustedAdult_counterpartyParticipantId_fkey" FOREIGN KEY ("counterpartyParticipantId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustedAdult" ADD CONSTRAINT "TrustedAdult_disclosedById_fkey" FOREIGN KEY ("disclosedById") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustedAdultReview" ADD CONSTRAINT "TrustedAdultReview_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporationLead" ADD CONSTRAINT "CorporationLead_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporationMember" ADD CONSTRAINT "CorporationMember_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Program" ADD CONSTRAINT "Program_leadMentorId_fkey" FOREIGN KEY ("leadMentorId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramVolunteer" ADD CONSTRAINT "ProgramVolunteer_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramParticipant" ADD CONSTRAINT "ProgramParticipant_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeePayment" ADD CONSTRAINT "FeePayment_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_attendanceConfirmedById_fkey" FOREIGN KEY ("attendanceConfirmedById") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RSVP" ADD CONSTRAINT "RSVP_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawBadgeLog" ADD CONSTRAINT "RawBadgeLog_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
