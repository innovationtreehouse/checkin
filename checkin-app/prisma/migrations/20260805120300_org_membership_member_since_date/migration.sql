-- OrgMembership.memberSince is a calendar date, not an instant.
--
-- `col::date`, never `(col AT TIME ZONE 'UTC')::date` — this is a timestamp
-- WITHOUT time zone, so AT TIME ZONE would resolve the cast in the connection's
-- TimeZone and shift every row back a day west of UTC. Self-backfilling.
--
-- The default is dropped and re-set around the type change: Postgres refuses to
-- retype a column whose default has no implicit cast to the new type. Three
-- statements that must land together, and migrate deploy adds no transaction.
BEGIN;

ALTER TABLE "OrgMembership" ALTER COLUMN "memberSince" DROP DEFAULT;
ALTER TABLE "OrgMembership" ALTER COLUMN "memberSince" TYPE date USING ("memberSince"::date);
ALTER TABLE "OrgMembership" ALTER COLUMN "memberSince" SET DEFAULT CURRENT_TIMESTAMP;

COMMIT;
