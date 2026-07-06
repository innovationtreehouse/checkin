-- a1 contract phase (HOUSEHOLD_LEAD_MODEL.md + DEPLOY_MIGRATION_ORDER_OF_OPERATIONS.md):
-- the HouseholdLead join table was fully superseded by Person.isHouseholdLead in
-- PR #917 (additive column + backfill in 20260706110000_person_is_household_lead
-- + full reader/writer cutover, shipped and rolled out FIRST). No running task references
-- the table, so it is safe to drop. This is the destructive half of the
-- expand-contract split — it MUST land in a later release than #917's backfill.
DROP TABLE "HouseholdLead";
