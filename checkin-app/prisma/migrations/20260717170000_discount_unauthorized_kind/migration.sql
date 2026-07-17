-- New reconciler exception kind: a non-volunteer household redeemed the
-- volunteer-rate discount code (the entitlement check #1074's variant gate
-- dropped along with the amount gate). Additive enum value only — legal inside
-- Prisma's migration transaction on Postgres 12+ (we run 15) because nothing in
-- this migration uses the new value.
ALTER TYPE "PaymentExceptionKind" ADD VALUE 'DISCOUNT_UNAUTHORIZED';
