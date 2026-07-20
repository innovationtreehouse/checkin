-- CreateEnum
CREATE TYPE "SyncTargetKind" AS ENUM ('google_group', 'slack_channel', 'newsletter');

-- AlterTable
ALTER TABLE "BoardSettings" ADD COLUMN     "membersGoogleGroupEmail" TEXT,
ADD COLUMN     "newsletterGoogleGroupEmail" TEXT;

-- AlterTable
ALTER TABLE "Program" ADD COLUMN     "googleGroupEmail" TEXT,
ADD COLUMN     "slackChannelId" TEXT,
ADD COLUMN     "slackWorkspaceInviteUrl" TEXT;

-- CreateTable
CREATE TABLE "ProgramSlackAuth" (
    "programId" INTEGER NOT NULL,
    "botToken" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" INTEGER,

    CONSTRAINT "ProgramSlackAuth_pkey" PRIMARY KEY ("programId")
);

-- CreateTable
CREATE TABLE "SyncState" (
    "id" SERIAL NOT NULL,
    "personId" INTEGER NOT NULL,
    "targetKind" "SyncTargetKind" NOT NULL,
    "targetRef" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "desired" BOOLEAN NOT NULL DEFAULT false,
    "applied" BOOLEAN NOT NULL DEFAULT false,
    "lastAttemptAt" TIMESTAMP(3),
    "error" TEXT,
    "inviteEmailedAt" TIMESTAMP(3),
    "removalWarnedAt" TIMESTAMP(3),
    "reasons" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SyncState_error_idx" ON "SyncState"("error");

-- CreateIndex
CREATE INDEX "SyncState_desired_applied_idx" ON "SyncState"("desired", "applied");

-- CreateIndex
CREATE UNIQUE INDEX "SyncState_personId_targetKind_targetRef_scope_key" ON "SyncState"("personId", "targetKind", "targetRef", "scope");

-- AddForeignKey
ALTER TABLE "ProgramSlackAuth" ADD CONSTRAINT "ProgramSlackAuth_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncState" ADD CONSTRAINT "SyncState_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ponytail: defensive anchor only — there is no read-only DB role granted SELECT on
-- this database today (s-read mirrors Shopify INTO checkin, it does not export
-- checkin data), so this REVOKE is a no-op against the app's own DML role. If a
-- read-only consumer of the checkin DB is ever added (the NOLOGIN grant-holder
-- pattern, infra/modules/checkin-bootstrap/bootstrap.sh does GRANT SELECT ON ALL
-- TABLES), that migration must also exclude this table by name for that role and
-- omit it from ALTER DEFAULT PRIVILEGES — see spec §9. PUBLIC is revoked now so no
-- future default-privilege grant silently includes it.
REVOKE SELECT ON "ProgramSlackAuth" FROM PUBLIC;
