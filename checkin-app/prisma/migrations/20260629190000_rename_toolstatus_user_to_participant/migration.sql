-- Rename ToolStatus.userId -> participantId (Person = Participant). Data-preserving RENAME (not drop/add).
-- PK (ToolStatus_pkey) tracks the column rename automatically; FK constraint renamed explicitly.

-- AlterTable
ALTER TABLE "ToolStatus" RENAME COLUMN "userId" TO "participantId";

-- RenameForeignKey
ALTER TABLE "ToolStatus" RENAME CONSTRAINT "ToolStatus_userId_fkey" TO "ToolStatus_participantId_fkey";
