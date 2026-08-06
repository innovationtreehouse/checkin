-- Program.startAt is a calendar date (the day a program starts), not an instant.
-- Contrast Event.startAt, which is a genuine datetime and stays TIMESTAMP(3).
--
-- `col::date`, never `(col AT TIME ZONE 'UTC')::date` — this is a timestamp
-- WITHOUT time zone, so AT TIME ZONE would resolve the cast in the connection's
-- TimeZone and shift every row back a day west of UTC. Self-backfilling.
ALTER TABLE "Program" ALTER COLUMN "startAt" TYPE date USING ("startAt"::date);
