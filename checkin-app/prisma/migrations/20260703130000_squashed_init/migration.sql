-- Squashed baseline: replaces the previous 49-migration chain (20260223050920_init .. 20260703120000_trusted_adult_hidden_at).
-- Generated from the final schema of that chain; verified schema-identical via pg_dump diff.
-- Data backfills from the old chain are omitted: they only migrated pre-existing rows, no-ops on a fresh DB.
-- Databases already migrated past the old chain must NOT run this. Reconcile history instead:
--   DELETE FROM "_prisma_migrations";
--   npx prisma migrate resolve --applied 20260703130000_squashed_init

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."AttestationResult" AS ENUM ('APPROVE', 'REJECT');

-- CreateEnum
CREATE TYPE "public"."AuditAction" AS ENUM ('CREATE', 'EDIT', 'DELETE', 'BECOME_ADMIN');

-- CreateEnum
CREATE TYPE "public"."EnrollmentStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "public"."OrgMembershipProcessKind" AS ENUM ('INITIAL', 'RENEWAL');

-- CreateEnum
CREATE TYPE "public"."OrgMembershipProcessStatus" AS ENUM ('INTAKE', 'PENDING_EXTERNAL_ACTION', 'PENDING_BG_REVIEW', 'PENDING_PAYMENT', 'ACTIVE', 'BLOCKED', 'PENDING_RENEWAL', 'RENEWAL_PENDING_BG', 'PENDING_BG_CLEARANCE');

-- CreateEnum
CREATE TYPE "public"."OrgMembershipStatus" AS ENUM ('NONE', 'ACTIVE', 'REVOKED', 'DENIED');

-- CreateEnum
CREATE TYPE "public"."ProgramParticipantStatus" AS ENUM ('PENDING', 'ACTIVE');

-- CreateEnum
CREATE TYPE "public"."ProgramPhase" AS ENUM ('PLANNING', 'UPCOMING', 'RUNNING', 'FINISHED');

-- CreateEnum
CREATE TYPE "public"."RSVPStatus" AS ENUM ('ATTENDING', 'NOT_ATTENDING', 'NO_RESPONSE', 'MAYBE');

-- CreateEnum
CREATE TYPE "public"."ToolLevel" AS ENUM ('BASIC', 'DOF', 'CERTIFIED', 'MAY_CERTIFY_OTHERS', 'INSTRUCTOR');

-- CreateEnum
CREATE TYPE "public"."TrustedAdultDecisionKind" AS ENUM ('APPROVE', 'DENY', 'REQUEST_INFO');

-- CreateEnum
CREATE TYPE "public"."TrustedAdultOrigin" AS ENUM ('SELF_DISCLOSED', 'STAFF_ENTERED');

-- CreateEnum
CREATE TYPE "public"."TrustedAdultReviewKind" AS ENUM ('INITIAL', 'RENEWAL');

-- CreateEnum
CREATE TYPE "public"."TrustedAdultReviewStatus" AS ENUM ('PENDING_BOARD_REVIEW', 'PENDING_SUBJECT_ACTION', 'APPROVED', 'DENIED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "public"."VisitSource" AS ENUM ('SCANNER', 'WEB', 'SYSTEM');

-- CreateTable
CREATE TABLE "public"."Account" (
    "id" TEXT NOT NULL,
    "participant_id" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AppSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "timezone" TEXT NOT NULL DEFAULT 'America/Chicago',
    "locale" TEXT NOT NULL DEFAULT 'en-US',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AuditLog" (
    "id" SERIAL NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" INTEGER NOT NULL,
    "action" "public"."AuditAction" NOT NULL,
    "tableName" TEXT NOT NULL,
    "affectedEntityId" INTEGER NOT NULL,
    "secondaryAffectedEntity" INTEGER,
    "oldData" JSONB,
    "newData" JSONB,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BackgroundCheckAttestation" (
    "id" SERIAL NOT NULL,
    "processId" INTEGER NOT NULL,
    "reviewerId" INTEGER NOT NULL,
    "result" "public"."AttestationResult" NOT NULL,
    "isMarkedVolunteer" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackgroundCheckAttestation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BoardSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "normalDuesCents" INTEGER NOT NULL DEFAULT 0,
    "volunteerDuesCents" INTEGER NOT NULL DEFAULT 0,
    "orgMembershipYearBoundary" TIMESTAMP(3),
    "shopifyOrgMembershipProductId" TEXT,
    "shopifyNormalVariantId" TEXT,
    "shopifyVolunteerVariantId" TEXT,
    "shopifyPriceSyncedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "bgRecheckMonths" INTEGER NOT NULL DEFAULT 0,
    "orgMembershipVariantId" TEXT,
    "volunteerDiscountCode" TEXT,

    CONSTRAINT "BoardSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Corporation" (
    "id" SERIAL NOT NULL,
    "primaryEmail" TEXT,
    "line1" TEXT,
    "line2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,

    CONSTRAINT "Corporation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CorporationLead" (
    "corporationId" INTEGER NOT NULL,
    "personId" INTEGER NOT NULL,

    CONSTRAINT "CorporationLead_pkey" PRIMARY KEY ("corporationId","personId")
);

-- CreateTable
CREATE TABLE "public"."CorporationMember" (
    "corporationId" INTEGER NOT NULL,
    "personId" INTEGER NOT NULL,

    CONSTRAINT "CorporationMember_pkey" PRIMARY KEY ("corporationId","personId")
);

-- CreateTable
CREATE TABLE "public"."DevLedger" (
    "id" SERIAL NOT NULL,
    "action" TEXT NOT NULL,
    "realActor" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DevLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DevSentEmail" (
    "id" SERIAL NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DevSentEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."EmergencyContact" (
    "id" SERIAL NOT NULL,
    "householdId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "relationship" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "phoneDigits" TEXT NOT NULL,
    "emailNorm" TEXT,
    "conflictParticipantId" INTEGER,
    "conflictedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmergencyContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ErrorLog" (
    "id" SERIAL NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "route" TEXT,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "context" JSONB,

    CONSTRAINT "ErrorLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Event" (
    "id" SERIAL NOT NULL,
    "programId" INTEGER,
    "name" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "attendanceConfirmedAt" TIMESTAMP(3),
    "attendanceConfirmedById" INTEGER,
    "postEventEmailSent" BOOLEAN NOT NULL DEFAULT false,
    "recurringGroupId" TEXT,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Fee" (
    "id" SERIAL NOT NULL,
    "programId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "nonOrgMemberPriceCents" INTEGER NOT NULL,
    "orgMemberPriceCents" INTEGER NOT NULL,

    CONSTRAINT "Fee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FeePayment" (
    "feeId" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "shopifyLink" TEXT,
    "quickBooksInvoice" TEXT,
    "customNote" TEXT,
    "personId" INTEGER NOT NULL,

    CONSTRAINT "FeePayment_pkey" PRIMARY KEY ("feeId","personId")
);

-- CreateTable
CREATE TABLE "public"."Household" (
    "id" SERIAL NOT NULL,
    "name" TEXT,
    "line1" TEXT,
    "line2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,

    CONSTRAINT "Household_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."HouseholdLead" (
    "householdId" INTEGER NOT NULL,
    "personId" INTEGER NOT NULL,

    CONSTRAINT "HouseholdLead_pkey" PRIMARY KEY ("householdId","personId")
);

-- CreateTable
CREATE TABLE "public"."IntegrationErrorLog" (
    "id" SERIAL NOT NULL,
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "context" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "IntegrationErrorLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OrgMembership" (
    "id" SERIAL NOT NULL,
    "memberSince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "householdId" INTEGER NOT NULL,
    "isVolunteer" BOOLEAN NOT NULL DEFAULT false,
    "status" "public"."OrgMembershipStatus" NOT NULL DEFAULT 'NONE',

    CONSTRAINT "OrgMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OrgMembershipProcess" (
    "id" SERIAL NOT NULL,
    "orgMembershipId" INTEGER NOT NULL,
    "kind" "public"."OrgMembershipProcessKind" NOT NULL,
    "status" "public"."OrgMembershipProcessStatus" NOT NULL,
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
    "zohoActionId" TEXT,
    "bgClearedAt" TIMESTAMP(3),

    CONSTRAINT "OrgMembershipProcess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Person" (
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

-- CreateTable
CREATE TABLE "public"."Program" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "leadMentorId" INTEGER,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "enrollmentStatus" "public"."EnrollmentStatus" NOT NULL DEFAULT 'CLOSED',
    "leadMentorNotificationSettings" JSONB,
    "maxAge" INTEGER,
    "maxParticipants" INTEGER,
    "minAge" INTEGER,
    "phase" "public"."ProgramPhase" NOT NULL DEFAULT 'PLANNING',
    "shopifyProductId" TEXT,
    "nonOrgMemberPriceCents" INTEGER,
    "orgMemberOnly" BOOLEAN NOT NULL DEFAULT false,
    "orgMemberPriceCents" INTEGER,
    "shopifyNonOrgMemberVariantId" TEXT,
    "shopifyOrgMemberVariantId" TEXT,

    CONSTRAINT "Program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProgramParticipant" (
    "programId" INTEGER NOT NULL,
    "personId" INTEGER NOT NULL,
    "isPaymentPlanRequested" BOOLEAN NOT NULL DEFAULT false,
    "pendingSince" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "status" "public"."ProgramParticipantStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "ProgramParticipant_pkey" PRIMARY KEY ("programId","personId")
);

-- CreateTable
CREATE TABLE "public"."ProgramVolunteer" (
    "programId" INTEGER NOT NULL,
    "personId" INTEGER NOT NULL,
    "isCore" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ProgramVolunteer_pkey" PRIMARY KEY ("programId","personId")
);

-- CreateTable
CREATE TABLE "public"."RSVP" (
    "eventId" INTEGER NOT NULL,
    "status" "public"."RSVPStatus" NOT NULL,
    "reminderSentAt" TIMESTAMP(3),
    "personId" INTEGER NOT NULL,

    CONSTRAINT "RSVP_pkey" PRIMARY KEY ("eventId","personId")
);

-- CreateTable
CREATE TABLE "public"."RawBadgeLog" (
    "id" SERIAL NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "location" TEXT,
    "personId" INTEGER NOT NULL,

    CONSTRAINT "RawBadgeLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "participant_id" INTEGER NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SystemMetricLog" (
    "id" SERIAL NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "SystemMetricLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Tool" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "safetyGuide" TEXT,

    CONSTRAINT "Tool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ToolStatus" (
    "personId" INTEGER NOT NULL,
    "toolId" INTEGER NOT NULL,
    "level" "public"."ToolLevel" NOT NULL,

    CONSTRAINT "ToolStatus_pkey" PRIMARY KEY ("personId","toolId")
);

-- CreateTable
CREATE TABLE "public"."TrustedAdult" (
    "id" SERIAL NOT NULL,
    "householdId" INTEGER NOT NULL,
    "trustedAdultPersonId" INTEGER,
    "trustedAdultName" TEXT NOT NULL,
    "familyContext" TEXT NOT NULL,
    "origin" "public"."TrustedAdultOrigin" NOT NULL DEFAULT 'SELF_DISCLOSED',
    "disclosedById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "trustedAdultPhone" TEXT,
    "trustedAdultEmail" TEXT,
    "hiddenAt" TIMESTAMP(3),

    CONSTRAINT "TrustedAdult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TrustedAdultReview" (
    "id" SERIAL NOT NULL,
    "trustedAdultId" INTEGER NOT NULL,
    "householdId" INTEGER NOT NULL,
    "kind" "public"."TrustedAdultReviewKind" NOT NULL,
    "status" "public"."TrustedAdultReviewStatus" NOT NULL DEFAULT 'PENDING_BOARD_REVIEW',
    "decidedById" INTEGER,
    "decision" "public"."TrustedAdultDecisionKind",
    "decisionNote" TEXT,
    "sharedNote" TEXT,
    "effectiveFrom" TIMESTAMP(3),
    "reviewBy" TIMESTAMP(3),
    "expiryWarningSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrustedAdultReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "public"."Visit" (
    "id" SERIAL NOT NULL,
    "personId" INTEGER NOT NULL,
    "arrivedAt" TIMESTAMP(3) NOT NULL,
    "departedAt" TIMESTAMP(3),
    "associatedEventId" INTEGER,
    "arrivedVia" "public"."VisitSource",
    "departedVia" "public"."VisitSource",

    CONSTRAINT "Visit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."VolunteerDesignation" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VolunteerDesignation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "public"."Account"("provider" ASC, "providerAccountId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BackgroundCheckAttestation_processId_reviewerId_key" ON "public"."BackgroundCheckAttestation"("processId" ASC, "reviewerId" ASC);

-- CreateIndex
CREATE INDEX "DevLedger_createdAt_idx" ON "public"."DevLedger"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "DevSentEmail_createdAt_idx" ON "public"."DevSentEmail"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "EmergencyContact_householdId_idx" ON "public"."EmergencyContact"("householdId" ASC);

-- CreateIndex
CREATE INDEX "EmergencyContact_phoneDigits_idx" ON "public"."EmergencyContact"("phoneDigits" ASC);

-- CreateIndex
CREATE INDEX "IntegrationErrorLog_resolvedAt_timestamp_idx" ON "public"."IntegrationErrorLog"("resolvedAt" ASC, "timestamp" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "OrgMembership_householdId_key" ON "public"."OrgMembership"("householdId" ASC);

-- CreateIndex
CREATE INDEX "OrgMembership_status_idx" ON "public"."OrgMembership"("status" ASC);

-- CreateIndex
CREATE INDEX "OrgMembershipProcess_orgMembershipId_idx" ON "public"."OrgMembershipProcess"("orgMembershipId" ASC);

-- CreateIndex
CREATE INDEX "OrgMembershipProcess_status_idx" ON "public"."OrgMembershipProcess"("status" ASC);

-- CreateIndex
-- Partial unique index (Prisma DSL can't express WHERE): one in-flight INITIAL process per membership.
CREATE UNIQUE INDEX "membership_one_inflight_initial" ON "public"."OrgMembershipProcess" ("orgMembershipId")
    WHERE "kind" = 'INITIAL'
      AND "status" IN ('INTAKE', 'PENDING_EXTERNAL_ACTION', 'PENDING_BG_REVIEW', 'PENDING_PAYMENT', 'PENDING_BG_CLEARANCE');

-- CreateIndex
-- Partial unique index (Prisma DSL can't express WHERE): one in-flight RENEWAL process per membership.
CREATE UNIQUE INDEX "membership_one_inflight_renewal" ON "public"."OrgMembershipProcess" ("orgMembershipId")
    WHERE "kind" = 'RENEWAL'
      AND "status" IN ('PENDING_RENEWAL', 'RENEWAL_PENDING_BG', 'PENDING_PAYMENT');

-- CreateIndex
CREATE UNIQUE INDEX "Person_email_key" ON "public"."Person"("email" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Person_googleId_key" ON "public"."Person"("googleId" ASC);

-- CreateIndex
CREATE INDEX "RawBadgeLog_personId_timestamp_idx" ON "public"."RawBadgeLog"("personId" ASC, "timestamp" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "public"."Session"("sessionToken" ASC);

-- CreateIndex
CREATE INDEX "TrustedAdult_householdId_idx" ON "public"."TrustedAdult"("householdId" ASC);

-- CreateIndex
CREATE INDEX "TrustedAdultReview_householdId_idx" ON "public"."TrustedAdultReview"("householdId" ASC);

-- CreateIndex
CREATE INDEX "TrustedAdultReview_status_idx" ON "public"."TrustedAdultReview"("status" ASC);

-- CreateIndex
CREATE INDEX "TrustedAdultReview_trustedAdultId_idx" ON "public"."TrustedAdultReview"("trustedAdultId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "public"."VerificationToken"("identifier" ASC, "token" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "public"."VerificationToken"("token" ASC);

-- CreateIndex
-- Partial unique index (Prisma DSL can't express WHERE): at most one open visit per person.
CREATE UNIQUE INDEX "Visit_one_open_per_participant" ON "public"."Visit" ("personId")
    WHERE "departedAt" IS NULL;

-- CreateIndex
CREATE INDEX "Visit_personId_departedAt_idx" ON "public"."Visit"("personId" ASC, "departedAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "VolunteerDesignation_email_key" ON "public"."VolunteerDesignation"("email" ASC);

-- AddForeignKey
ALTER TABLE "public"."Account" ADD CONSTRAINT "Account_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "public"."Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BackgroundCheckAttestation" ADD CONSTRAINT "BackgroundCheckAttestation_processId_fkey" FOREIGN KEY ("processId") REFERENCES "public"."OrgMembershipProcess"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BackgroundCheckAttestation" ADD CONSTRAINT "BackgroundCheckAttestation_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "public"."Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CorporationLead" ADD CONSTRAINT "CorporationLead_corporationId_fkey" FOREIGN KEY ("corporationId") REFERENCES "public"."Corporation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CorporationLead" ADD CONSTRAINT "CorporationLead_personId_fkey" FOREIGN KEY ("personId") REFERENCES "public"."Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CorporationMember" ADD CONSTRAINT "CorporationMember_corporationId_fkey" FOREIGN KEY ("corporationId") REFERENCES "public"."Corporation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CorporationMember" ADD CONSTRAINT "CorporationMember_personId_fkey" FOREIGN KEY ("personId") REFERENCES "public"."Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EmergencyContact" ADD CONSTRAINT "EmergencyContact_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "public"."Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Event" ADD CONSTRAINT "Event_attendanceConfirmedById_fkey" FOREIGN KEY ("attendanceConfirmedById") REFERENCES "public"."Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Event" ADD CONSTRAINT "Event_programId_fkey" FOREIGN KEY ("programId") REFERENCES "public"."Program"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Fee" ADD CONSTRAINT "Fee_programId_fkey" FOREIGN KEY ("programId") REFERENCES "public"."Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FeePayment" ADD CONSTRAINT "FeePayment_feeId_fkey" FOREIGN KEY ("feeId") REFERENCES "public"."Fee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FeePayment" ADD CONSTRAINT "FeePayment_personId_fkey" FOREIGN KEY ("personId") REFERENCES "public"."Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."HouseholdLead" ADD CONSTRAINT "HouseholdLead_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "public"."Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."HouseholdLead" ADD CONSTRAINT "HouseholdLead_personId_fkey" FOREIGN KEY ("personId") REFERENCES "public"."Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrgMembership" ADD CONSTRAINT "OrgMembership_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "public"."Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrgMembershipProcess" ADD CONSTRAINT "OrgMembershipProcess_orgMembershipId_fkey" FOREIGN KEY ("orgMembershipId") REFERENCES "public"."OrgMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Person" ADD CONSTRAINT "Person_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "public"."Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Program" ADD CONSTRAINT "Program_leadMentorId_fkey" FOREIGN KEY ("leadMentorId") REFERENCES "public"."Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProgramParticipant" ADD CONSTRAINT "ProgramParticipant_personId_fkey" FOREIGN KEY ("personId") REFERENCES "public"."Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProgramParticipant" ADD CONSTRAINT "ProgramParticipant_programId_fkey" FOREIGN KEY ("programId") REFERENCES "public"."Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProgramVolunteer" ADD CONSTRAINT "ProgramVolunteer_personId_fkey" FOREIGN KEY ("personId") REFERENCES "public"."Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProgramVolunteer" ADD CONSTRAINT "ProgramVolunteer_programId_fkey" FOREIGN KEY ("programId") REFERENCES "public"."Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RSVP" ADD CONSTRAINT "RSVP_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "public"."Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RSVP" ADD CONSTRAINT "RSVP_personId_fkey" FOREIGN KEY ("personId") REFERENCES "public"."Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RawBadgeLog" ADD CONSTRAINT "RawBadgeLog_personId_fkey" FOREIGN KEY ("personId") REFERENCES "public"."Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Session" ADD CONSTRAINT "Session_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "public"."Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ToolStatus" ADD CONSTRAINT "ToolStatus_personId_fkey" FOREIGN KEY ("personId") REFERENCES "public"."Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ToolStatus" ADD CONSTRAINT "ToolStatus_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "public"."Tool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TrustedAdult" ADD CONSTRAINT "TrustedAdult_disclosedById_fkey" FOREIGN KEY ("disclosedById") REFERENCES "public"."Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TrustedAdult" ADD CONSTRAINT "TrustedAdult_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "public"."Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TrustedAdult" ADD CONSTRAINT "TrustedAdult_trustedAdultPersonId_fkey" FOREIGN KEY ("trustedAdultPersonId") REFERENCES "public"."Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TrustedAdultReview" ADD CONSTRAINT "TrustedAdultReview_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "public"."Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TrustedAdultReview" ADD CONSTRAINT "TrustedAdultReview_trustedAdultId_fkey" FOREIGN KEY ("trustedAdultId") REFERENCES "public"."TrustedAdult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Visit" ADD CONSTRAINT "Visit_associatedEventId_fkey" FOREIGN KEY ("associatedEventId") REFERENCES "public"."Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Visit" ADD CONSTRAINT "Visit_personId_fkey" FOREIGN KEY ("personId") REFERENCES "public"."Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
