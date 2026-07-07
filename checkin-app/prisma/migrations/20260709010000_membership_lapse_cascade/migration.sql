-- Membership lapse/revocation cascade to program enrollment.
-- Additive + nullable only (expand step): safe to apply to a populated table.

-- Grace-clock + notification-dedup stamp for the lapse cascade. NULL = not
-- currently flagged. Lapsed-ness itself is derived live from OrgMembership; this
-- only times the grace window and dedups the one-time notification.
ALTER TABLE "OrgMembership" ADD COLUMN "lapseFlaggedAt" TIMESTAMP(3);

-- Days a lapsed household keeps its flagged enrollments before auto-withdraw.
-- NULL = auto-withdraw OFF (flag/block/notify stay on). Mirrors
-- scholarshipDenialGraceDays' NULL-is-off semantics.
ALTER TABLE "BoardSettings" ADD COLUMN "membershipLapseGraceDays" INTEGER;
