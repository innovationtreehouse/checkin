-- Board admins configure the membership dues product by pasting its storefront
-- URL; the server extracts the Shopify variant ID from it. Stored so the board
-- can see which product the variant ID came from and re-run the extraction.
-- Additive only.
ALTER TABLE "BoardSettings" ADD COLUMN "orgMembershipProductUrl" TEXT;
