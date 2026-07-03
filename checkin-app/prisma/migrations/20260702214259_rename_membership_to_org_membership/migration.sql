-- Rename Membership -> OrgMembership terminology (Phase 4d). This is a pure rename:
-- tables, enums, the membershipId column, BoardSettings.*membership* columns, and
-- constraint/index names. Done with ALTER ... RENAME (NOT drop+create) so the two
-- raw-SQL partial unique indexes on OrgMembershipProcess — membership_one_inflight_initial
-- and membership_one_inflight_renewal, which are NOT declared in schema.prisma — survive.
-- Postgres carries indexes and FK constraints through table/column RENAME automatically.

-- Enums
ALTER TYPE "MembershipStatus" RENAME TO "OrgMembershipStatus";
ALTER TYPE "MembershipProcessKind" RENAME TO "OrgMembershipProcessKind";
ALTER TYPE "MembershipProcessStatus" RENAME TO "OrgMembershipProcessStatus";

-- Tables
ALTER TABLE "Membership" RENAME TO "OrgMembership";
ALTER TABLE "MembershipProcess" RENAME TO "OrgMembershipProcess";

-- FK scalar column
ALTER TABLE "OrgMembershipProcess" RENAME COLUMN "membershipId" TO "orgMembershipId";

-- BoardSettings columns (data preserved via RENAME; DB is wiped on deploy anyway)
ALTER TABLE "BoardSettings" RENAME COLUMN "membershipYearBoundary" TO "orgMembershipYearBoundary";
ALTER TABLE "BoardSettings" RENAME COLUMN "membershipVariantId" TO "orgMembershipVariantId";
ALTER TABLE "BoardSettings" RENAME COLUMN "shopifyMembershipProductId" TO "shopifyOrgMembershipProductId";

-- Primary keys
ALTER INDEX "Membership_pkey" RENAME TO "OrgMembership_pkey";
ALTER INDEX "MembershipProcess_pkey" RENAME TO "OrgMembershipProcess_pkey";

-- Managed indexes (schema-declared)
ALTER INDEX "Membership_householdId_key" RENAME TO "OrgMembership_householdId_key";
ALTER INDEX "Membership_status_idx" RENAME TO "OrgMembership_status_idx";
ALTER INDEX "MembershipProcess_membershipId_idx" RENAME TO "OrgMembershipProcess_orgMembershipId_idx";
ALTER INDEX "MembershipProcess_status_idx" RENAME TO "OrgMembershipProcess_status_idx";

-- FK constraints (definitions auto-repoint on table rename; rename names for tidiness)
ALTER TABLE "OrgMembership" RENAME CONSTRAINT "Membership_householdId_fkey" TO "OrgMembership_householdId_fkey";
ALTER TABLE "OrgMembershipProcess" RENAME CONSTRAINT "MembershipProcess_membershipId_fkey" TO "OrgMembershipProcess_orgMembershipId_fkey";

-- NOTE: the two partial unique indexes membership_one_inflight_initial /
-- membership_one_inflight_renewal are intentionally NOT renamed or recreated here —
-- they follow the table + column rename automatically and keep their descriptive names.
