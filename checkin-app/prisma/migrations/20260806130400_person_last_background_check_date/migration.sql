-- Person.lastBackgroundCheck is a calendar date, not an instant. A compliance
-- report that reads a background-check day one early is the bug this prevents;
-- `date` removes the zone that produced it.
--
-- `col::date`, never `(col AT TIME ZONE 'UTC')::date` — this is a timestamp
-- WITHOUT time zone, so AT TIME ZONE would resolve the cast in the connection's
-- TimeZone and shift every row back a day west of UTC. Self-backfilling.
ALTER TABLE "Person" ALTER COLUMN "lastBackgroundCheck" TYPE date USING ("lastBackgroundCheck"::date);
