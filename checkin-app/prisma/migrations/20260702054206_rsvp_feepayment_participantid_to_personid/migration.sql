-- Rename FeePayment/RSVP FK column participantId -> personId (Phase A1c of
-- Participant->Person). Use RENAME (not Prisma's default DROP+ADD): the generated
-- DROP COLUMN + ADD COLUMN "personId" NOT NULL fails on any non-empty table
-- (23502 "column contains null values" — this wedged the dev deploy on 2026-07-02)
-- and would discard the FK data even where it succeeds.
ALTER TABLE "FeePayment" RENAME COLUMN "participantId" TO "personId";
ALTER TABLE "RSVP" RENAME COLUMN "participantId" TO "personId";

-- The composite PKs ("FeePayment_pkey", "RSVP_pkey") follow the renamed column
-- automatically. Keep the FK constraint names in sync with Prisma's expectations.
ALTER TABLE "FeePayment" RENAME CONSTRAINT "FeePayment_participantId_fkey" TO "FeePayment_personId_fkey";
ALTER TABLE "RSVP" RENAME CONSTRAINT "RSVP_participantId_fkey" TO "RSVP_personId_fkey";
