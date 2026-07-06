-- Make Household.name NOT NULL. Every live create path already writes a name
-- (OAuth: email fallback; membership-ops: 'User' fallback; Zoho: 'Household'
-- literal), so no live row is expected to be null. Backfill defensively anyway:
-- copy a household member's name, else the literal 'Household', before the
-- NOT NULL constraint so the migration can never fail on the real DB.
UPDATE "Household" h
SET "name" = COALESCE(
    (SELECT p."name"
       FROM "Person" p
      WHERE p."householdId" = h."id"
        AND p."name" IS NOT NULL
      ORDER BY p."id"
      LIMIT 1),
    'Household'
)
WHERE h."name" IS NULL;

ALTER TABLE "Household" ALTER COLUMN "name" SET NOT NULL;
