-- Two open Visit rows for one participant corrupts two-deep supervision math: a
-- departed minor still counts as present & supervised. The MANUAL_CHECKIN path
-- (POST /api/attendance) read-then-created with no advisory lock, so two concurrent
-- check-ins — or one racing a kiosk /api/scan or /api/attendance/manual — both passed
-- the "already checked in?" guard and created two open visits. A later checkout closes
-- only one; the other lingers open forever, inflating the open-visit count.
--
-- This partial unique index is the DB-level backstop: at most one open visit
-- (departedAt IS NULL) per participant. The second concurrent insert hits P2002,
-- which the (now advisory-locked) check-in paths turn into a clean re-check/no-op.
--
-- Prisma's schema DSL can't express a partial unique index (WHERE on NULL), so this
-- is raw SQL. Mirrors the membership_one_inflight_renewal precedent.

-- Pre-step: close any pre-existing duplicate open visits, else the unique index
-- creation fails. Keep the earliest open visit per participant (oldest arrivedAt,
-- lowest id as tiebreak); stamp departedAt = now() on the rest.
UPDATE "Visit" v
SET "departedAt" = now()
WHERE v."departedAt" IS NULL
  AND EXISTS (
    SELECT 1 FROM "Visit" o
    WHERE o."participantId" = v."participantId"
      AND o."departedAt" IS NULL
      AND (o."arrivedAt" < v."arrivedAt"
           OR (o."arrivedAt" = v."arrivedAt" AND o."id" < v."id"))
  );

CREATE UNIQUE INDEX "Visit_one_open_per_participant"
    ON "Visit" ("participantId")
    WHERE "departedAt" IS NULL;
