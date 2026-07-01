-- One in-flight INITIAL process per membership. startIntake's check-then-act
-- (does an in-flight INITIAL process already exist?) is NOT atomic on its own —
-- a double-click or two tabs can both read zero open processes and both INSERT,
-- yielding duplicate INTAKE rows. startIntake now serializes its own check+insert
-- by locking the parent Membership row (SELECT ... FOR UPDATE), same as
-- createRenewalProcess. This partial unique index is the multi-instance
-- guarantee: the second concurrent insert hits P2002.
--
-- "In flight" is the status-based set IN_FLIGHT_INITIAL_STATUSES (phases.ts), the
-- same set startIntake's own check already used. Prisma's schema DSL can't
-- express a partial unique index with a WHERE on enum status, so this is raw SQL.

-- Pre-step: neutralize any pre-existing duplicate in-flight INITIAL processes (from
-- the pre-fix race) so the index can be created on already-affected data — else
-- CREATE UNIQUE INDEX fails on deploy. Keep the NEWEST (MAX id) per membership: that's
-- the row startIntake returns (orderBy id desc) and the one saveIntake wrote the
-- applicant's data onto. Move older duplicate(s) to BLOCKED — there is no CANCELLED
-- status, BLOCKED is the only non-in-flight terminal state, and this preserves the
-- row + audit trail rather than deleting (FK-safe vs BackgroundCheckAttestation).
-- Mirrors the visit_one_open_per_participant precedent's pre-step.
UPDATE "MembershipProcess" p
SET "status" = 'BLOCKED'
WHERE p."kind" = 'INITIAL'
  AND p."status" IN ('INTAKE', 'PENDING_EXTERNAL_ACTION', 'PENDING_BG_REVIEW', 'PENDING_PAYMENT', 'PENDING_BG_CLEARANCE')
  AND EXISTS (
    SELECT 1 FROM "MembershipProcess" o
    WHERE o."membershipId" = p."membershipId"
      AND o."kind" = 'INITIAL'
      AND o."status" IN ('INTAKE', 'PENDING_EXTERNAL_ACTION', 'PENDING_BG_REVIEW', 'PENDING_PAYMENT', 'PENDING_BG_CLEARANCE')
      AND o."id" > p."id"
  );

CREATE UNIQUE INDEX "membership_one_inflight_initial"
    ON "MembershipProcess" ("membershipId")
    WHERE "kind" = 'INITIAL'
      AND "status" IN ('INTAKE', 'PENDING_EXTERNAL_ACTION', 'PENDING_BG_REVIEW', 'PENDING_PAYMENT', 'PENDING_BG_CLEARANCE');
