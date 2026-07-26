-- Data-only backfill: reinterpret unanchored midnight-UTC start/end dates as
-- org-local midnight. The trailing AT TIME ZONE 'UTC' keeps the write independent
-- of the session TimeZone; already-anchored rows and NULLs don't match the
-- predicate, so re-running is a no-op. Zone is a deliberate literal (see PR body).

BEGIN;

UPDATE "Program"
SET "startAt" = ("startAt" AT TIME ZONE 'America/Chicago') AT TIME ZONE 'UTC'
WHERE "startAt"::time = '00:00:00';

UPDATE "Program"
SET "endAt" = ("endAt" AT TIME ZONE 'America/Chicago') AT TIME ZONE 'UTC'
WHERE "endAt"::time = '00:00:00';

COMMIT;
