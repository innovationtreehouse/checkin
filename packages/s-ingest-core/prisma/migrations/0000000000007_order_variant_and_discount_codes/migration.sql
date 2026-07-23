-- Variant identity mirrored onto order lines, so checkin's match audit can tell a
-- membership/program purchase (variant id ∈ BoardSettings/Program shopify*VariantId)
-- from a donation/t-shirt line that is not expected to reconcile. Nullable + additive:
-- old sync code keeps writing rows without them during the rolling deploy; rows synced
-- before this shipped stay null until a BACKFILL run repopulates them (the persisted
-- bulk JSONL predates the query change, so reingestBulkExports cannot fill these).
ALTER TABLE "shop_order_line" ADD COLUMN "variant_gid" TEXT;
ALTER TABLE "shop_order_line" ADD COLUMN "variant_legacy_id" TEXT;
-- The audit's entry query is "lines whose variant is one of checkin's known ids".
CREATE INDEX "shop_order_line_store_id_variant_legacy_id_idx" ON "shop_order_line"("store_id", "variant_legacy_id");

-- Coupon codes applied at checkout, mirrored verbatim so checkin can tell a
-- board-created discount (volunteer rate, time-boxed promo) from a real shortfall
-- instead of raising AMOUNT_MISMATCH on every couponed order. NOT NULL DEFAULT '{}'
-- (Prisma scalar lists can't be null), so an empty array on a pre-existing row means
-- "not yet re-synced", not "no codes" — the same backfill run fills these.
ALTER TABLE "shop_order" ADD COLUMN "discount_codes" TEXT[] NOT NULL DEFAULT '{}';
