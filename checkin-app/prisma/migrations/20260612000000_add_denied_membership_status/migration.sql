-- Board "Denied Membership" state. Additive enum value — no backfill.
-- DENIED blocks login for every member of the household (enforced in the auth layer),
-- distinct from REVOKED (former member who keeps app access but loses facility privileges).
ALTER TYPE "MembershipStatus" ADD VALUE 'DENIED';
