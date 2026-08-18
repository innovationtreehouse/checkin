-- Additive, nullable: legacy/web writers keep writing NULL clientEventId
-- (Postgres NULLs don't collide on a unique index), so nothing else changes.
-- clientEventId is the kiosk replay idempotency key; reviewReason marks a
-- replay parked instead of toggled (docs/designs/KIOSK_RESILIENCE.md §2).
ALTER TABLE "RawBadgeLog" ADD COLUMN "clientEventId" TEXT;
ALTER TABLE "RawBadgeLog" ADD COLUMN "reviewReason" TEXT;

-- CONCURRENTLY: RawBadgeLog is a live, high-traffic table — a plain unique
-- index build would hold a lock across it. A migration containing
-- CREATE INDEX CONCURRENTLY runs outside a transaction automatically.
CREATE UNIQUE INDEX CONCURRENTLY "RawBadgeLog_clientEventId_key" ON "RawBadgeLog"("clientEventId");
