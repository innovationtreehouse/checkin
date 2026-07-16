-- Renewals now go through the same external step as new applications
-- (PENDING_EXTERNAL_ACTION: sign a fresh agreement, and request a new background
-- check on Averity if the previous one expired, then payment while the review
-- runs in parallel) instead of parking at RENEWAL_PENDING_BG. Move the
-- already-parked open rows there so members stuck on the passive "Renewal in
-- progress" screen get the actionable flow on their next visit.
-- bgConsentAt is always NULL on these rows (consent was unreachable from
-- RENEWAL_PENDING_BG), and rows a reviewer already cleared (bgClearedAt set)
-- have left this status, so the two predicates below are belt-and-braces.
-- Known edge, accepted: a renewal held here only for its household note (its
-- background check still valid) is also moved and will be asked to consent once
-- more (rare — the flow shipped days ago; converges via the note-hold at
-- PENDING_BG_REVIEW).
UPDATE "OrgMembershipProcess"
SET "status" = 'PENDING_EXTERNAL_ACTION',
    "stageEnteredAt" = NOW()
WHERE "kind" = 'RENEWAL'
  AND "status" = 'RENEWAL_PENDING_BG'
  AND "bgClearedAt" IS NULL;

-- Renewals can now sit in the request-flow states, so the one-inflight-renewal
-- guard must cover them or the sweep could open a duplicate cycle for a
-- household mid-flow. Defense-in-depth behind the row lock in
-- createRenewalProcess; must stay in step with IN_FLIGHT_RENEWAL_STATUSES
-- (renewal.ts). No existing rows can violate the widened predicate: renewals
-- never reached the added statuses before this migration.
DROP INDEX IF EXISTS "membership_one_inflight_renewal";
CREATE UNIQUE INDEX "membership_one_inflight_renewal" ON "OrgMembershipProcess" ("orgMembershipId")
WHERE "kind" = 'RENEWAL' AND "status" IN (
  'PENDING_RENEWAL', 'PENDING_EXTERNAL_ACTION', 'PENDING_BG_REVIEW',
  'PENDING_PAYMENT', 'PENDING_BG_CLEARANCE', 'RENEWAL_PENDING_BG'
);
