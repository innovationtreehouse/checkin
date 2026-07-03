-- Rename Fee/Program price-tier fields member* -> orgMember* plus the Shopify
-- variant-id columns. Use RENAME (not Prisma's default DROP+ADD): the generated
-- version fails on a non-empty Fee (ADD COLUMN NOT NULL without default) and
-- silently discards prices, the member-only flag, and Shopify variant ids
-- everywhere else.
ALTER TABLE "Fee" RENAME COLUMN "memberPriceCents" TO "orgMemberPriceCents";
ALTER TABLE "Fee" RENAME COLUMN "nonMemberPriceCents" TO "nonOrgMemberPriceCents";

ALTER TABLE "Program" RENAME COLUMN "memberOnly" TO "orgMemberOnly";
ALTER TABLE "Program" RENAME COLUMN "memberPriceCents" TO "orgMemberPriceCents";
ALTER TABLE "Program" RENAME COLUMN "nonMemberPriceCents" TO "nonOrgMemberPriceCents";
ALTER TABLE "Program" RENAME COLUMN "shopifyMemberVariantId" TO "shopifyOrgMemberVariantId";
ALTER TABLE "Program" RENAME COLUMN "shopifyNonMemberVariantId" TO "shopifyNonOrgMemberVariantId";
