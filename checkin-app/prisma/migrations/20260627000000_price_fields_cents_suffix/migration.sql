-- Rename price columns to carry their unit (integer cents) in the name.
-- Values are already cents (see 20260626000000_program_fee_prices_to_cents); columns unchanged.
ALTER TABLE "Program" RENAME COLUMN "memberPrice" TO "memberPriceCents";
ALTER TABLE "Program" RENAME COLUMN "nonMemberPrice" TO "nonMemberPriceCents";
ALTER TABLE "Fee" RENAME COLUMN "memberPrice" TO "memberPriceCents";
ALTER TABLE "Fee" RENAME COLUMN "nonMemberPrice" TO "nonMemberPriceCents";
