-- Volunteer discount moves from a per-tier Shopify price to a discount code.
-- membershipVariantId: the Shopify variant ID of the membership product every
--   household checks out through. The "Pay with Shopify" link is built from it as
--   https://<SHOPIFY_STORE_DOMAIN>/cart/<membershipVariantId>:1.
-- volunteerDiscountCode: the code (created in Shopify by the board) appended to
--   that link for volunteer households so Shopify applies their discount.
-- Additive, nullable columns — no backfill.
ALTER TABLE "BoardSettings" ADD COLUMN "membershipVariantId" TEXT;
ALTER TABLE "BoardSettings" ADD COLUMN "volunteerDiscountCode" TEXT;
