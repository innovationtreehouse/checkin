-- One in-flight RENEWAL process per membership. The renewal sweep (cron) and the
-- admin "open renewals" button both check-then-act through createRenewalProcess,
-- and neither serializes the read+create — overlapping cron runs, a cron racing
-- the admin button, or an admin double-click each read zero open processes and both
-- INSERT, yielding duplicate PENDING_RENEWAL rows (duplicate reminder emails + a
-- dangling process beginRenewalForUser never advances). This partial unique index
-- is the multi-instance guarantee: the second concurrent insert hits P2002, which
-- createRenewalProcess catches and treats as a clean no-op.
--
-- "In flight" is the status-based set (the three non-terminal renewal statuses), not
-- the leakier createdAt window the sweep used. Prisma's schema DSL can't express a
-- partial unique index with a WHERE on enum status, so this is raw SQL.
CREATE UNIQUE INDEX "membership_one_inflight_renewal"
    ON "MembershipProcess" ("membershipId")
    WHERE "kind" = 'RENEWAL'
      AND "status" IN ('PENDING_RENEWAL', 'RENEWAL_PENDING_BG', 'PENDING_PAYMENT');
