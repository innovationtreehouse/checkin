-- Dev-instance-only signing-target override (settings radio: real Zoho vs the
-- debug interstitial). Additive nullable column — no backfill, no lock risk.
ALTER TABLE "BoardSettings" ADD COLUMN "devSigningTarget" TEXT;
