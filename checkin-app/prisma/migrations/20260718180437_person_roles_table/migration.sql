-- CreateEnum
CREATE TYPE "PersonRoleKind" AS ENUM ('SYSADMIN', 'BOARD', 'KEYHOLDER', 'BG_REVIEWER', 'OPERATIONS');

-- CreateTable
CREATE TABLE "PersonRole" (
    "personId"    INTEGER        NOT NULL,
    "role"        "PersonRoleKind" NOT NULL,
    "grantedAt"   TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedById" INTEGER,
    CONSTRAINT "PersonRole_pkey" PRIMARY KEY ("personId", "role")
);

-- AddForeignKey
ALTER TABLE "PersonRole" ADD CONSTRAINT "PersonRole_personId_fkey"
    FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonRole" ADD CONSTRAINT "PersonRole_grantedById_fkey"
    FOREIGN KEY ("grantedById") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill from the four existing boolean columns.
-- isOperations is intentionally absent: no column ever shipped, so no rows to backfill.
-- grantedById stays NULL for backfilled rows (system-granted, pre-metadata).
INSERT INTO "PersonRole" ("personId", "role", "grantedAt")
SELECT "id", 'SYSADMIN'::"PersonRoleKind", CURRENT_TIMESTAMP FROM "Person" WHERE "isSysadmin" = true
UNION ALL
SELECT "id", 'BOARD',       CURRENT_TIMESTAMP FROM "Person" WHERE "isBoardMember" = true
UNION ALL
SELECT "id", 'KEYHOLDER',   CURRENT_TIMESTAMP FROM "Person" WHERE "isKeyholder" = true
UNION ALL
SELECT "id", 'BG_REVIEWER', CURRENT_TIMESTAMP FROM "Person" WHERE "isBackgroundCheckReviewer" = true;
