-- Rename DateTime columns to normalized names. Data-preserving RENAME (not drop/add).
-- FeePayment.paidOn -> paidAt; Membership.since -> memberSince; Participant.dob -> dateOfBirth.

-- AlterTable
ALTER TABLE "FeePayment" RENAME COLUMN "paidOn" TO "paidAt";

-- AlterTable
ALTER TABLE "Membership" RENAME COLUMN "since" TO "memberSince";

-- AlterTable
ALTER TABLE "Participant" RENAME COLUMN "dob" TO "dateOfBirth";
