-- Rename HouseholdLead.participantId -> personId and ToolStatus.participantId -> personId
-- (Person = Participant). Data-preserving RENAME (not drop/add).
-- PK (composite) tracks the column rename automatically; FK constraints renamed explicitly.

-- AlterTable
ALTER TABLE "HouseholdLead" RENAME COLUMN "participantId" TO "personId";

-- RenameForeignKey
ALTER TABLE "HouseholdLead" RENAME CONSTRAINT "HouseholdLead_participantId_fkey" TO "HouseholdLead_personId_fkey";

-- AlterTable
ALTER TABLE "ToolStatus" RENAME COLUMN "participantId" TO "personId";

-- RenameForeignKey
ALTER TABLE "ToolStatus" RENAME CONSTRAINT "ToolStatus_participantId_fkey" TO "ToolStatus_personId_fkey";
