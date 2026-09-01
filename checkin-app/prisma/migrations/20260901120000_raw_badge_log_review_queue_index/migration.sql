-- The unsynced-scans queue predicate (reviewReason set, not yet reviewed) is
-- counted on every full-access /api/attendance poll for the door display's
-- need-review badge — once a minute, forever, on an append-only scan log with
-- no covering index. A partial index keeps that count O(queue size) instead of
-- a sequential scan of the whole table. Same shape as the one-open-visit
-- partial index; Prisma cannot express a partial WHERE, so it is hand-written.
CREATE INDEX "RawBadgeLog_review_queue" ON "RawBadgeLog"("id")
    WHERE ("reviewReason" IS NOT NULL AND "reviewedAt" IS NULL);
