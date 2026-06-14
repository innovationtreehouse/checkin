-- EmergencyContact entity: promote the flat Household.emergencyContact* fields
-- into a first-class 1:many table that can link external (non-family) people.

-- 1. New table
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

CREATE INDEX "EmergencyContact_householdId_idx" ON "EmergencyContact"("householdId");
CREATE INDEX "EmergencyContact_phoneDigits_idx" ON "EmergencyContact"("phoneDigits");

ALTER TABLE "EmergencyContact"
    ADD CONSTRAINT "EmergencyContact_householdId_fkey"
    FOREIGN KEY ("householdId") REFERENCES "Household"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Backfill: one contact row per household that already has either flat field.
--    phoneDigits/emailNorm are the normalized identity keys used by the
--    not-a-household-member check (must match lib/emergencyContacts/identity.ts).
INSERT INTO "EmergencyContact"
    ("householdId", "name", "phone", "phoneDigits", "priority", "createdAt", "updatedAt")
SELECT
    h."id",
    COALESCE(h."emergencyContactName", ''),
    COALESCE(h."emergencyContactPhone", ''),
    regexp_replace(COALESCE(h."emergencyContactPhone", ''), '[^0-9]', '', 'g'),
    0,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Household" h
WHERE NULLIF(TRIM(COALESCE(h."emergencyContactName", '')), '') IS NOT NULL
   OR NULLIF(TRIM(COALESCE(h."emergencyContactPhone", '')), '') IS NOT NULL;

-- 3. Drop the now-migrated flat columns.
ALTER TABLE "Household" DROP COLUMN "emergencyContactName";
ALTER TABLE "Household" DROP COLUMN "emergencyContactPhone";
