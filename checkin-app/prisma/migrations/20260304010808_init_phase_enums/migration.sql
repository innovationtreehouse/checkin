-- CreateEnum
CREATE TYPE "ProgramPhase" AS ENUM ('PLANNING', 'UPCOMING', 'RUNNING', 'FINISHED');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('OPEN', 'CLOSED');

-- AlterTable
ALTER TABLE "Household" ADD COLUMN     "name" TEXT;

-- AlterTable
ALTER TABLE "Participant" ADD COLUMN     "emailVerified" TIMESTAMP(3),
ADD COLUMN     "image" TEXT,
ADD COLUMN     "name" TEXT,
ADD COLUMN     "notificationSettings" JSONB,
ALTER COLUMN "email" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Program" ADD COLUMN     "enrollmentStatus" "EnrollmentStatus" NOT NULL DEFAULT 'CLOSED',
ADD COLUMN     "leadMentorNotificationSettings" JSONB,
ADD COLUMN     "maxAge" INTEGER,
ADD COLUMN     "maxParticipants" INTEGER,
ADD COLUMN     "memberOnly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "minAge" INTEGER,
ADD COLUMN     "phase" "ProgramPhase" NOT NULL DEFAULT 'PLANNING';

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

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
