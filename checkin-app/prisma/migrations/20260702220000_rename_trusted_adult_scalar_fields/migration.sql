-- P2-2 Phase A1: rename the trusted-adult scalar fields to align with the model.
-- RENAME (not drop+add) to preserve data and any partial indexes on the columns.
-- FK counterpartyParticipantId + the counterparty relation are renamed separately in A2.
ALTER TABLE "TrustedAdult" RENAME COLUMN "counterpartyName" TO "trustedAdultName";
ALTER TABLE "TrustedAdult" RENAME COLUMN "counterpartyPhone" TO "trustedAdultPhone";
ALTER TABLE "TrustedAdult" RENAME COLUMN "counterpartyEmail" TO "trustedAdultEmail";
