-- Additive, nullable: retires a program's Shopify listing (board/sysadmin action,
-- program-ops → Shopify section). NULL = the listing is live (every existing row,
-- the correct default); a timestamp = the listing was archived (Shopify product set
-- to `archived` status, all app-side checkout surfaces treat it as absent). Cleared
-- back to NULL on un-archive. Expand-only — no backfill, no contract step.
-- See docs/designs/SHOPIFY_LISTING_ARCHIVE.md.
ALTER TABLE "Program" ADD COLUMN "shopifyArchivedAt" TIMESTAMP(3);
