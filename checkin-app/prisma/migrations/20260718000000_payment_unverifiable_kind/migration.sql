-- Additive enum value: an activation whose recorded Shopify order id isn't in the
-- mirror (deleted in Shopify, or a backfill/low-water gap). Distinct from
-- ACTIVE_WITHOUT_PAYMENT — a payment is on record, it just can't be verified.
--
-- ALTER TYPE ... ADD VALUE is safe on live data (no rewrite, no existing row
-- changes) and additive-only. Postgres runs it non-transactionally when the new
-- value is not consumed in the same statement batch, which it isn't here.
ALTER TYPE "PaymentExceptionKind" ADD VALUE IF NOT EXISTS 'PAYMENT_UNVERIFIABLE';
