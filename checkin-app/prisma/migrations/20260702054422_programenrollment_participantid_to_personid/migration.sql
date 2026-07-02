-- Rename ProgramParticipant.participantId / ProgramVolunteer.participantId -> personId
-- (Person = Participant). Data-preserving RENAME (not drop/add). The composite
-- PK (programId, <col>) tracks the column rename automatically; FK constraints
-- renamed explicitly.

-- AlterTable
ALTER TABLE "ProgramParticipant" RENAME COLUMN "participantId" TO "personId";
ALTER TABLE "ProgramParticipant" RENAME CONSTRAINT "ProgramParticipant_participantId_fkey" TO "ProgramParticipant_personId_fkey";

-- AlterTable
ALTER TABLE "ProgramVolunteer" RENAME COLUMN "participantId" TO "personId";
ALTER TABLE "ProgramVolunteer" RENAME CONSTRAINT "ProgramVolunteer_participantId_fkey" TO "ProgramVolunteer_personId_fkey";
