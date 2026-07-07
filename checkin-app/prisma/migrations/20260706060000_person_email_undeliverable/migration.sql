-- Additive, nullable: tracks when Resend last reported this person's address as
-- undeliverable (bounce/complaint), cleared on a later successful delivery. No
-- backfill needed (nullable, defaults to "deliverable").
ALTER TABLE "Person" ADD COLUMN "emailUndeliverableAt" TIMESTAMP(3);
