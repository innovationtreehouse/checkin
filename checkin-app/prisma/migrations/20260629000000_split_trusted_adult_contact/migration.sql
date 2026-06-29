-- Split TrustedAdult.counterpartyContact (free-text "phone or email") into two
-- structured nullable columns. At-least-one is enforced in app code, not SQL.

ALTER TABLE "TrustedAdult" ADD COLUMN "counterpartyPhone" TEXT;
ALTER TABLE "TrustedAdult" ADD COLUMN "counterpartyEmail" TEXT;

-- Backfill: a value containing '@' is an email, otherwise treat it as a phone.
UPDATE "TrustedAdult" SET "counterpartyEmail" = "counterpartyContact" WHERE "counterpartyContact" LIKE '%@%';
UPDATE "TrustedAdult" SET "counterpartyPhone" = "counterpartyContact" WHERE "counterpartyContact" NOT LIKE '%@%';

ALTER TABLE "TrustedAdult" DROP COLUMN "counterpartyContact";
