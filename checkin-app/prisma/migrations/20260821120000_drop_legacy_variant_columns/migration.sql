-- Drop the four legacy two-variant Shopify columns (#975, Release 2).
-- Both pairs have been superseded: Program by shopifyVariantId (single-pool),
-- BoardSettings by orgMembershipVariantId + volunteerDiscountCode.
-- No live row carries data in any of them (re-verified at cutover).

BEGIN;

ALTER TABLE "BoardSettings" DROP COLUMN "shopifyNormalVariantId";
ALTER TABLE "BoardSettings" DROP COLUMN "shopifyVolunteerVariantId";

ALTER TABLE "Program" DROP COLUMN "shopifyOrgMemberVariantId";
ALTER TABLE "Program" DROP COLUMN "shopifyNonOrgMemberVariantId";

COMMIT;
