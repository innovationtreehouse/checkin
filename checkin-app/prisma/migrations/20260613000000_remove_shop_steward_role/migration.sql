-- The Shop Steward role is removed. No role grants carte-blanche
-- "may certify others" authority anymore: only sysadmin/board may promote a
-- user to MAY_CERTIFY_OTHERS, and such users can change certification status up
-- to (but not including) MAY_CERTIFY_OTHERS.

-- DropColumn
ALTER TABLE "Participant" DROP COLUMN "shopSteward";
