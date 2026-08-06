-- Program.endAt is a calendar date (the day a program ends), not an instant.
-- Contrast Event.endAt, which is a genuine datetime and stays TIMESTAMP(3).
--
-- `col::date`, never `(col AT TIME ZONE 'UTC')::date` — this is a timestamp
-- WITHOUT time zone, so AT TIME ZONE would resolve the cast in the connection's
-- TimeZone and shift every row back a day west of UTC. Self-backfilling.
ALTER TABLE "Program" ALTER COLUMN "endAt" TYPE date USING ("endAt"::date);
