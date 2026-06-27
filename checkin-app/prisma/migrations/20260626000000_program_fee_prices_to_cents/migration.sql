-- Convert Program and Fee prices from whole dollars to integer cents.
-- Membership dues are already cents and are untouched.
UPDATE "Program" SET "memberPrice" = "memberPrice" * 100 WHERE "memberPrice" IS NOT NULL;
UPDATE "Program" SET "nonMemberPrice" = "nonMemberPrice" * 100 WHERE "nonMemberPrice" IS NOT NULL;
UPDATE "Fee" SET "memberPrice" = "memberPrice" * 100;
UPDATE "Fee" SET "nonMemberPrice" = "nonMemberPrice" * 100;
