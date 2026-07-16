-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ToolLevel" AS ENUM ('BASIC', 'DOF', 'CERTIFIED', 'INSTRUCTOR', 'MAY_CERTIFY_OTHERS');

-- CreateEnum
CREATE TYPE "RSVPStatus" AS ENUM ('ATTENDING', 'NOT_ATTENDING', 'NO_RESPONSE', 'MAYBE');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'EDIT', 'DELETE', 'BECOME_ADMIN');

-- CreateEnum
CREATE TYPE "VisitSource" AS ENUM ('SCANNER', 'WEB', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ProgramPhase" AS ENUM ('PLANNING', 'UPCOMING', 'RUNNING', 'FINISHED');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ProgramParticipantStatus" AS ENUM ('PENDING', 'ACTIVE');

-- CreateEnum
CREATE TYPE "OrgMembershipStatus" AS ENUM ('NONE', 'ACTIVE', 'REVOKED', 'DENIED');

-- CreateEnum
CREATE TYPE "OrgMembershipProcessKind" AS ENUM ('INITIAL', 'RENEWAL', 'PERSON_BG');

-- CreateEnum
CREATE TYPE "OrgMembershipProcessStatus" AS ENUM ('INTAKE', 'PENDING_EXTERNAL_ACTION', 'PENDING_BG_REVIEW', 'PENDING_PAYMENT', 'PENDING_BG_CLEARANCE', 'ACTIVE', 'BLOCKED', 'PENDING_RENEWAL', 'RENEWAL_PENDING_BG', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AttestationResult" AS ENUM ('APPROVE', 'REJECT');

-- CreateEnum
CREATE TYPE "TrustedAdultOrigin" AS ENUM ('SELF_DISCLOSED', 'STAFF_ENTERED');

-- CreateEnum
CREATE TYPE "TrustedAdultReviewKind" AS ENUM ('INITIAL', 'RENEWAL', 'MODIFIED');

-- CreateEnum
CREATE TYPE "TrustedAdultReviewStatus" AS ENUM ('PENDING_BOARD_REVIEW', 'PENDING_SUBJECT_ACTION', 'APPROVED', 'DENIED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "TrustedAdultDecisionKind" AS ENUM ('APPROVE', 'DENY', 'REQUEST_INFO');

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
    "emailUndeliverableAt" TIMESTAMP(3),
    "notificationSettings" JSONB,
    "householdId" INTEGER NOT NULL,
    "isHouseholdLead" BOOLEAN NOT NULL DEFAULT false,
    "allergies" TEXT,
    "isSysadmin" BOOLEAN NOT NULL DEFAULT false,
    "isBoardMember" BOOLEAN NOT NULL DEFAULT false,
    "isKeyholder" BOOLEAN NOT NULL DEFAULT false,
    "isBackgroundCheckReviewer" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
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
    "personId" INTEGER NOT NULL,
    "toolId" INTEGER NOT NULL,
    "level" "ToolLevel" NOT NULL,

    CONSTRAINT "ToolStatus_pkey" PRIMARY KEY ("personId","toolId")
);

-- CreateTable
CREATE TABLE "Household" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "line1" TEXT,
    "line2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "intakeNotes" TEXT,

    CONSTRAINT "Household_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyContact" (
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
CREATE TABLE "OrgMembership" (
    "id" SERIAL NOT NULL,
    "memberSince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "OrgMembershipStatus" NOT NULL DEFAULT 'NONE',
    "isVolunteer" BOOLEAN NOT NULL DEFAULT false,
    "householdId" INTEGER NOT NULL,

    CONSTRAINT "OrgMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgMembershipProcess" (
    "id" SERIAL NOT NULL,
    "orgMembershipId" INTEGER,
    "subjectPersonId" INTEGER,
    "kind" "OrgMembershipProcessKind" NOT NULL,
    "status" "OrgMembershipProcessStatus" NOT NULL,
    "stageEnteredAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "zohoEnvelopeId" TEXT,
    "zohoActionId" TEXT,
    "contractSignedAt" TIMESTAMP(3),
    "bgConsentAt" TIMESTAMP(3),
    "bgClearedAt" TIMESTAMP(3),
    "shopifyDraftOrderId" TEXT,
    "shopifyInvoiceUrl" TEXT,
    "shopifyOrderId" TEXT,
    "paidAt" TIMESTAMP(3),
    "certifiedById" INTEGER,
    "renewalReminderSentAt" TIMESTAMP(3),
    "isPaymentPlanRequested" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "OrgMembershipProcess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackgroundCheckAttestation" (
    "id" SERIAL NOT NULL,
    "processId" INTEGER NOT NULL,
    "reviewerId" INTEGER NOT NULL,
    "result" "AttestationResult" NOT NULL,
    "isMarkedVolunteer" BOOLEAN NOT NULL DEFAULT false,
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
    "orgMembershipYearBoundary" TIMESTAMP(3),
    "orgMembershipVariantId" TEXT,
    "volunteerDiscountCode" TEXT,
    "bgRecheckMonths" INTEGER NOT NULL DEFAULT 0,
    "devSigningTarget" TEXT,
    "emailFromAddress" TEXT,
    "emailReplyToAddress" TEXT,
    "shopifyOrgMembershipProductId" TEXT,
    "shopifyNormalVariantId" TEXT,
    "shopifyVolunteerVariantId" TEXT,
    "shopifyPriceSyncedAt" TIMESTAMP(3),
    "scholarshipDenialGraceDays" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoardSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "timezone" TEXT NOT NULL DEFAULT 'America/Chicago',
    "locale" TEXT NOT NULL DEFAULT 'en-US',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustedAdult" (
    "id" SERIAL NOT NULL,
    "householdId" INTEGER NOT NULL,
    "trustedAdultPersonId" INTEGER,
    "trustedAdultName" TEXT NOT NULL,
    "trustedAdultPhone" TEXT,
    "trustedAdultEmail" TEXT,
    "familyContext" TEXT NOT NULL,
    "origin" "TrustedAdultOrigin" NOT NULL DEFAULT 'SELF_DISCLOSED',
    "disclosedById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "hiddenAt" TIMESTAMP(3),

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
    "proposedName" TEXT,
    "proposedPhone" TEXT,
    "proposedEmail" TEXT,
    "proposedContext" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrustedAdultReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Corporation" (
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
CREATE TABLE "CorporationLead" (
    "corporationId" INTEGER NOT NULL,
    "personId" INTEGER NOT NULL,

    CONSTRAINT "CorporationLead_pkey" PRIMARY KEY ("corporationId","personId")
);

-- CreateTable
CREATE TABLE "CorporationMember" (
    "corporationId" INTEGER NOT NULL,
    "personId" INTEGER NOT NULL,

    CONSTRAINT "CorporationMember_pkey" PRIMARY KEY ("corporationId","personId")
);

-- CreateTable
CREATE TABLE "Program" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "leadMentorId" INTEGER,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "phase" "ProgramPhase" NOT NULL DEFAULT 'PLANNING',
    "enrollmentStatus" "EnrollmentStatus" NOT NULL DEFAULT 'CLOSED',
    "orgMemberOnly" BOOLEAN NOT NULL DEFAULT false,
    "minAge" INTEGER,
    "maxAge" INTEGER,
    "maxParticipants" INTEGER,
    "leadMentorNotificationSettings" JSONB,
    "orgMemberPriceCents" INTEGER,
    "nonOrgMemberPriceCents" INTEGER,
    "shopifyProductId" TEXT,
    "shopifyOrgMemberVariantId" TEXT,
    "shopifyNonOrgMemberVariantId" TEXT,
    "shopifyVariantId" TEXT,

    CONSTRAINT "Program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramVolunteer" (
    "programId" INTEGER NOT NULL,
    "personId" INTEGER NOT NULL,
    "isCore" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ProgramVolunteer_pkey" PRIMARY KEY ("programId","personId")
);

-- CreateTable
CREATE TABLE "ProgramParticipant" (
    "programId" INTEGER NOT NULL,
    "personId" INTEGER NOT NULL,
    "status" "ProgramParticipantStatus" NOT NULL DEFAULT 'PENDING',
    "isPaymentPlanRequested" BOOLEAN NOT NULL DEFAULT false,
    "pendingSince" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "wasOrgMemberAtApproval" BOOLEAN,
    "inventoryHeldAt" TIMESTAMP(3),
    "paymentPlanDeniedAt" TIMESTAMP(3),

    CONSTRAINT "ProgramParticipant_pkey" PRIMARY KEY ("programId","personId")
);

-- CreateTable
CREATE TABLE "Fee" (
    "id" SERIAL NOT NULL,
    "programId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "nonOrgMemberPriceCents" INTEGER NOT NULL,
    "orgMemberPriceCents" INTEGER NOT NULL,

    CONSTRAINT "Fee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeePayment" (
    "feeId" INTEGER NOT NULL,
    "personId" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "shopifyLink" TEXT,
    "quickBooksInvoice" TEXT,
    "customNote" TEXT,

    CONSTRAINT "FeePayment_pkey" PRIMARY KEY ("feeId","personId")
);

-- CreateTable
CREATE TABLE "Event" (
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
CREATE TABLE "RSVP" (
    "eventId" INTEGER NOT NULL,
    "personId" INTEGER NOT NULL,
    "status" "RSVPStatus" NOT NULL,
    "reminderSentAt" TIMESTAMP(3),

    CONSTRAINT "RSVP_pkey" PRIMARY KEY ("eventId","personId")
);

-- CreateTable
CREATE TABLE "RawBadgeLog" (
    "id" SERIAL NOT NULL,
    "personId" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "location" TEXT,

    CONSTRAINT "RawBadgeLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Visit" (
    "id" SERIAL NOT NULL,
    "personId" INTEGER NOT NULL,
    "arrivedAt" TIMESTAMP(3) NOT NULL,
    "departedAt" TIMESTAMP(3),
    "arrivedVia" "VisitSource",
    "departedVia" "VisitSource",
    "associatedEventId" INTEGER,

    CONSTRAINT "Visit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" INTEGER NOT NULL,
    "action" "AuditAction" NOT NULL,
    "tableName" TEXT NOT NULL,
    "affectedEntityId" INTEGER NOT NULL,
    "secondaryAffectedEntity" INTEGER,
    "oldData" JSONB,
    "newData" JSONB,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
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
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "participant_id" INTEGER NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "ErrorLog" (
    "id" SERIAL NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "route" TEXT,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "context" JSONB,

    CONSTRAINT "ErrorLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemMetricLog" (
    "id" SERIAL NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "SystemMetricLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationErrorLog" (
    "id" SERIAL NOT NULL,
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "context" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "IntegrationErrorLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DevLedger" (
    "id" SERIAL NOT NULL,
    "action" TEXT NOT NULL,
    "realActor" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DevLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DevSentEmail" (
    "id" SERIAL NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DevSentEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Person_googleId_key" ON "Person"("googleId");

-- CreateIndex
CREATE UNIQUE INDEX "Person_email_key" ON "Person"("email");

-- CreateIndex
CREATE INDEX "Person_householdId_isHouseholdLead_idx" ON "Person"("householdId", "isHouseholdLead");

-- CreateIndex
CREATE INDEX "EmergencyContact_householdId_idx" ON "EmergencyContact"("householdId");

-- CreateIndex
CREATE INDEX "EmergencyContact_phoneDigits_idx" ON "EmergencyContact"("phoneDigits");

-- CreateIndex
CREATE UNIQUE INDEX "OrgMembership_householdId_key" ON "OrgMembership"("householdId");

-- CreateIndex
CREATE INDEX "OrgMembership_status_idx" ON "OrgMembership"("status");

-- CreateIndex
CREATE INDEX "OrgMembershipProcess_orgMembershipId_idx" ON "OrgMembershipProcess"("orgMembershipId");

-- CreateIndex
CREATE INDEX "OrgMembershipProcess_status_idx" ON "OrgMembershipProcess"("status");

-- CreateIndex
CREATE UNIQUE INDEX "BackgroundCheckAttestation_processId_reviewerId_key" ON "BackgroundCheckAttestation"("processId", "reviewerId");

-- CreateIndex
CREATE UNIQUE INDEX "VolunteerDesignation_email_key" ON "VolunteerDesignation"("email");

-- CreateIndex
CREATE INDEX "TrustedAdult_householdId_idx" ON "TrustedAdult"("householdId");

-- CreateIndex
CREATE INDEX "TrustedAdultReview_trustedAdultId_idx" ON "TrustedAdultReview"("trustedAdultId");

-- CreateIndex
CREATE INDEX "TrustedAdultReview_status_idx" ON "TrustedAdultReview"("status");

-- CreateIndex
CREATE INDEX "TrustedAdultReview_householdId_idx" ON "TrustedAdultReview"("householdId");

-- CreateIndex
CREATE INDEX "RawBadgeLog_personId_timestamp_idx" ON "RawBadgeLog"("personId", "timestamp");

-- CreateIndex
CREATE INDEX "Visit_personId_departedAt_idx" ON "Visit"("personId", "departedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE INDEX "IntegrationErrorLog_resolvedAt_timestamp_idx" ON "IntegrationErrorLog"("resolvedAt", "timestamp");

-- CreateIndex
CREATE INDEX "DevLedger_createdAt_idx" ON "DevLedger"("createdAt");

-- CreateIndex
CREATE INDEX "DevSentEmail_createdAt_idx" ON "DevSentEmail"("createdAt");

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolStatus" ADD CONSTRAINT "ToolStatus_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolStatus" ADD CONSTRAINT "ToolStatus_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "Tool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyContact" ADD CONSTRAINT "EmergencyContact_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgMembership" ADD CONSTRAINT "OrgMembership_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgMembershipProcess" ADD CONSTRAINT "OrgMembershipProcess_orgMembershipId_fkey" FOREIGN KEY ("orgMembershipId") REFERENCES "OrgMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgMembershipProcess" ADD CONSTRAINT "OrgMembershipProcess_subjectPersonId_fkey" FOREIGN KEY ("subjectPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackgroundCheckAttestation" ADD CONSTRAINT "BackgroundCheckAttestation_processId_fkey" FOREIGN KEY ("processId") REFERENCES "OrgMembershipProcess"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackgroundCheckAttestation" ADD CONSTRAINT "BackgroundCheckAttestation_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustedAdult" ADD CONSTRAINT "TrustedAdult_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustedAdult" ADD CONSTRAINT "TrustedAdult_trustedAdultPersonId_fkey" FOREIGN KEY ("trustedAdultPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustedAdult" ADD CONSTRAINT "TrustedAdult_disclosedById_fkey" FOREIGN KEY ("disclosedById") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustedAdultReview" ADD CONSTRAINT "TrustedAdultReview_trustedAdultId_fkey" FOREIGN KEY ("trustedAdultId") REFERENCES "TrustedAdult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustedAdultReview" ADD CONSTRAINT "TrustedAdultReview_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporationLead" ADD CONSTRAINT "CorporationLead_corporationId_fkey" FOREIGN KEY ("corporationId") REFERENCES "Corporation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporationLead" ADD CONSTRAINT "CorporationLead_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporationMember" ADD CONSTRAINT "CorporationMember_corporationId_fkey" FOREIGN KEY ("corporationId") REFERENCES "Corporation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporationMember" ADD CONSTRAINT "CorporationMember_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Program" ADD CONSTRAINT "Program_leadMentorId_fkey" FOREIGN KEY ("leadMentorId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramVolunteer" ADD CONSTRAINT "ProgramVolunteer_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramVolunteer" ADD CONSTRAINT "ProgramVolunteer_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramParticipant" ADD CONSTRAINT "ProgramParticipant_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramParticipant" ADD CONSTRAINT "ProgramParticipant_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fee" ADD CONSTRAINT "Fee_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeePayment" ADD CONSTRAINT "FeePayment_feeId_fkey" FOREIGN KEY ("feeId") REFERENCES "Fee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeePayment" ADD CONSTRAINT "FeePayment_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_attendanceConfirmedById_fkey" FOREIGN KEY ("attendanceConfirmedById") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RSVP" ADD CONSTRAINT "RSVP_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RSVP" ADD CONSTRAINT "RSVP_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawBadgeLog" ADD CONSTRAINT "RawBadgeLog_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_associatedEventId_fkey" FOREIGN KEY ("associatedEventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- coalesce-migrations: partial unique index restored — prisma migrate diff --from-empty
-- has no @@unique/@@index in schema.prisma to reconstruct this from (Prisma's DSL can't
-- express a WHERE clause) and drops it silently. Spliced verbatim from the TRUTH DB's
-- pg_indexes.indexdef for "Visit_one_open_per_participant".
CREATE UNIQUE INDEX "Visit_one_open_per_participant" ON public."Visit" USING btree ("personId") WHERE ("departedAt" IS NULL);

-- coalesce-migrations: partial unique index restored — prisma migrate diff --from-empty
-- has no @@unique/@@index in schema.prisma to reconstruct this from (Prisma's DSL can't
-- express a WHERE clause) and drops it silently. Spliced verbatim from the TRUTH DB's
-- pg_indexes.indexdef for "membership_one_inflight_initial".
CREATE UNIQUE INDEX membership_one_inflight_initial ON public."OrgMembershipProcess" USING btree ("orgMembershipId") WHERE ((kind = 'INITIAL'::"OrgMembershipProcessKind") AND (status = ANY (ARRAY['INTAKE'::"OrgMembershipProcessStatus", 'PENDING_EXTERNAL_ACTION'::"OrgMembershipProcessStatus", 'PENDING_BG_REVIEW'::"OrgMembershipProcessStatus", 'PENDING_PAYMENT'::"OrgMembershipProcessStatus", 'PENDING_BG_CLEARANCE'::"OrgMembershipProcessStatus"])));

-- coalesce-migrations: partial unique index restored — prisma migrate diff --from-empty
-- has no @@unique/@@index in schema.prisma to reconstruct this from (Prisma's DSL can't
-- express a WHERE clause) and drops it silently. Spliced verbatim from the TRUTH DB's
-- pg_indexes.indexdef for "membership_one_inflight_renewal".
CREATE UNIQUE INDEX membership_one_inflight_renewal ON public."OrgMembershipProcess" USING btree ("orgMembershipId") WHERE ((kind = 'RENEWAL'::"OrgMembershipProcessKind") AND (status = ANY (ARRAY['PENDING_RENEWAL'::"OrgMembershipProcessStatus", 'RENEWAL_PENDING_BG'::"OrgMembershipProcessStatus", 'PENDING_PAYMENT'::"OrgMembershipProcessStatus"])));
