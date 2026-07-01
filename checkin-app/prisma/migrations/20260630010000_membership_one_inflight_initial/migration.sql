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
CREATE UNIQUE INDEX "membership_one_inflight_initial"
    ON "MembershipProcess" ("membershipId")
    WHERE "kind" = 'INITIAL'
      AND "status" IN ('INTAKE', 'PENDING_EXTERNAL_ACTION', 'PENDING_BG_REVIEW', 'PENDING_PAYMENT', 'PENDING_BG_CLEARANCE');
