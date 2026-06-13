-- CreateEnum
CREATE TYPE "ToolLevel" AS ENUM ('BASIC', 'DOF', 'CERTIFIED', 'MAY_CERTIFY_OTHERS');

-- CreateEnum
CREATE TYPE "MembershipType" AS ENUM ('HOUSEHOLD', 'VOLUNTEER', 'CORPORATE');

-- CreateEnum
CREATE TYPE "RSVPStatus" AS ENUM ('ATTENDING', 'NOT_ATTENDING', 'NO_RESPONSE', 'MAYBE');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'EDIT', 'DELETE', 'BECOME_ADMIN');

-- CreateTable
CREATE TABLE "Participant" (
    "id" SERIAL NOT NULL,
    "googleId" TEXT,
    "email" TEXT NOT NULL,
    "dob" TIMESTAMP(3),
    "homeAddress" TEXT,
    "lastWaiverSign" TIMESTAMP(3),
    "waiverSignedBy" INTEGER,
    "lastBackgroundCheck" TIMESTAMP(3),
    "householdId" INTEGER,
    "sysadmin" BOOLEAN NOT NULL DEFAULT false,
    "boardMember" BOOLEAN NOT NULL DEFAULT false,
    "keyholder" BOOLEAN NOT NULL DEFAULT false,
    "shopSteward" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tool" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "safetyGuide" TEXT,

    CONSTRAINT "Tool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolStatus" (
    "userId" INTEGER NOT NULL,
    "toolId" INTEGER NOT NULL,
    "level" "ToolLevel" NOT NULL,

    CONSTRAINT "ToolStatus_pkey" PRIMARY KEY ("userId","toolId")
);

-- CreateTable
CREATE TABLE "Household" (
    "id" SERIAL NOT NULL,
    "address" TEXT,

    CONSTRAINT "Household_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HouseholdLead" (
    "householdId" INTEGER NOT NULL,
    "participantId" INTEGER NOT NULL,

    CONSTRAINT "HouseholdLead_pkey" PRIMARY KEY ("householdId","participantId")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" SERIAL NOT NULL,
    "since" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" "MembershipType" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "latestShopifyReceipt" TEXT,
    "latestDocusign" TEXT,
    "householdId" INTEGER,
    "volunteerId" INTEGER,
    "corporateId" INTEGER,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Corporation" (
    "id" SERIAL NOT NULL,
    "primaryEmail" TEXT,
    "address" TEXT,

    CONSTRAINT "Corporation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorporationLead" (
    "corporationId" INTEGER NOT NULL,
    "participantId" INTEGER NOT NULL,

    CONSTRAINT "CorporationLead_pkey" PRIMARY KEY ("corporationId","participantId")
);

-- CreateTable
CREATE TABLE "CorporationMember" (
    "corporationId" INTEGER NOT NULL,
    "participantId" INTEGER NOT NULL,

    CONSTRAINT "CorporationMember_pkey" PRIMARY KEY ("corporationId","participantId")
);

-- CreateTable
CREATE TABLE "Program" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "leadMentorId" INTEGER,
    "begin" TIMESTAMP(3),
    "end" TIMESTAMP(3),

    CONSTRAINT "Program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramVolunteer" (
    "programId" INTEGER NOT NULL,
    "participantId" INTEGER NOT NULL,
    "isCore" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ProgramVolunteer_pkey" PRIMARY KEY ("programId","participantId")
);

-- CreateTable
CREATE TABLE "ProgramParticipant" (
    "programId" INTEGER NOT NULL,
    "participantId" INTEGER NOT NULL,

    CONSTRAINT "ProgramParticipant_pkey" PRIMARY KEY ("programId","participantId")
);

-- CreateTable
CREATE TABLE "Fee" (
    "id" SERIAL NOT NULL,
    "programId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "nonMemberPrice" INTEGER NOT NULL,
    "memberPrice" INTEGER NOT NULL,

    CONSTRAINT "Fee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeePayment" (
    "feeId" INTEGER NOT NULL,
    "participantId" INTEGER NOT NULL,
    "paidOn" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "shopifyLink" TEXT,
    "quickBooksInvoice" TEXT,
    "customNote" TEXT,

    CONSTRAINT "FeePayment_pkey" PRIMARY KEY ("feeId","participantId")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" SERIAL NOT NULL,
    "programId" INTEGER,
    "name" TEXT NOT NULL,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3) NOT NULL,
    "description" TEXT,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RSVP" (
    "eventId" INTEGER NOT NULL,
    "participantId" INTEGER NOT NULL,
    "status" "RSVPStatus" NOT NULL,

    CONSTRAINT "RSVP_pkey" PRIMARY KEY ("eventId","participantId")
);

-- CreateTable
CREATE TABLE "RawBadgeEvent" (
    "id" SERIAL NOT NULL,
    "participantId" INTEGER NOT NULL,
    "time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "location" TEXT,

    CONSTRAINT "RawBadgeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Visit" (
    "id" SERIAL NOT NULL,
    "participantId" INTEGER NOT NULL,
    "arrived" TIMESTAMP(3) NOT NULL,
    "departed" TIMESTAMP(3),
    "associatedEventId" INTEGER,

    CONSTRAINT "Visit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" INTEGER NOT NULL,
    "action" "AuditAction" NOT NULL,
    "tableName" TEXT NOT NULL,
    "affectedEntityId" INTEGER NOT NULL,
    "secondaryAffectedEntity" INTEGER,
    "oldData" JSONB,
    "newData" JSONB,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Participant_googleId_key" ON "Participant"("googleId");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_email_key" ON "Participant"("email");

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolStatus" ADD CONSTRAINT "ToolStatus_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Participant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolStatus" ADD CONSTRAINT "ToolStatus_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "Tool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseholdLead" ADD CONSTRAINT "HouseholdLead_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseholdLead" ADD CONSTRAINT "HouseholdLead_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_volunteerId_fkey" FOREIGN KEY ("volunteerId") REFERENCES "Participant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_corporateId_fkey" FOREIGN KEY ("corporateId") REFERENCES "Corporation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporationLead" ADD CONSTRAINT "CorporationLead_corporationId_fkey" FOREIGN KEY ("corporationId") REFERENCES "Corporation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporationLead" ADD CONSTRAINT "CorporationLead_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporationMember" ADD CONSTRAINT "CorporationMember_corporationId_fkey" FOREIGN KEY ("corporationId") REFERENCES "Corporation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporationMember" ADD CONSTRAINT "CorporationMember_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramVolunteer" ADD CONSTRAINT "ProgramVolunteer_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramVolunteer" ADD CONSTRAINT "ProgramVolunteer_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramParticipant" ADD CONSTRAINT "ProgramParticipant_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramParticipant" ADD CONSTRAINT "ProgramParticipant_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fee" ADD CONSTRAINT "Fee_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeePayment" ADD CONSTRAINT "FeePayment_feeId_fkey" FOREIGN KEY ("feeId") REFERENCES "Fee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeePayment" ADD CONSTRAINT "FeePayment_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RSVP" ADD CONSTRAINT "RSVP_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RSVP" ADD CONSTRAINT "RSVP_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawBadgeEvent" ADD CONSTRAINT "RawBadgeEvent_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_associatedEventId_fkey" FOREIGN KEY ("associatedEventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
