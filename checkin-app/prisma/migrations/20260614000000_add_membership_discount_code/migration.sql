-- Volunteer discount moves from a per-tier Shopify price to a discount code.
-- membershipCheckoutUrl: the Shopify product/checkout permalink the "Pay with
--   Shopify" button links to for every household.
-- volunteerDiscountCode: the code (created in Shopify by the board) appended to
--   that link for volunteer households so Shopify applies their discount.
-- Additive, nullable columns — no backfill.
ALTER TABLE "BoardSettings" ADD COLUMN "membershipCheckoutUrl" TEXT;
ALTER TABLE "BoardSettings" ADD COLUMN "volunteerDiscountCode" TEXT;
