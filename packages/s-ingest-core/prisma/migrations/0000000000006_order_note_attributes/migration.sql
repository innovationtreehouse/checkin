-- Cart attributes (Membership_Process_ID / CheckMeIn_Account_ID + Program_ID) mirrored
-- from the Shopify order's customAttributes. Nullable + additive: old sync code keeps
-- writing rows without it during the rolling deploy, new rows populate it.
ALTER TABLE "shop_order" ADD COLUMN "note_attributes" JSONB;
