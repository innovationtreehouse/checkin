-- Additive, nullable: single-pool Shopify variant for new-model programs (one
-- variant priced at the base/non-member rate; member pricing is a per-enrollee
-- discount code at checkout, not a separate variant). Legacy programs keep
-- shopifyOrgMemberVariantId/shopifyNonOrgMemberVariantId untouched — this is
-- an expand-only step; dropping the legacy pair is a later contract release.
ALTER TABLE "Program" ADD COLUMN "shopifyVariantId" TEXT;
