-- P2-2 Phase A2: rename the trusted-adult Person FK + relation to match the model.
-- RENAME (not drop+add) to preserve the FK's data and referential integrity.
-- The relation name change ("TrustedAdultCounterparty" -> "TrustedAdultPerson") and
-- the back-relation rename are Prisma-level only; no SQL. Only the column + its FK
-- constraint touch the database.
ALTER TABLE "TrustedAdult" RENAME COLUMN "counterpartyParticipantId" TO "trustedAdultPersonId";
ALTER TABLE "TrustedAdult" RENAME CONSTRAINT "TrustedAdult_counterpartyParticipantId_fkey" TO "TrustedAdult_trustedAdultPersonId_fkey";
