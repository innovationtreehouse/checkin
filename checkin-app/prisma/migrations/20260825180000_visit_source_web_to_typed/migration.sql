-- #1624 contract (data): remaining WEB rows are typed-form clocks. Writers
-- already stamp TYPED (#1744). Do not touch LEAD_MARKED (roster window vs
-- staff-typed time cannot be told apart). WEB stays on the Postgres enum
-- so a rolling-deploy old task that still writes it does not 500; Prisma
-- keeps the value until no live task can emit it.
--
-- Idempotent: only rewrites WEB. Wrapped because both columns must move
-- together (Prisma does not wrap migrations in a transaction on Postgres).

BEGIN;

UPDATE "Visit"
SET "arrivedVia" = 'TYPED'
WHERE "arrivedVia" = 'WEB';

UPDATE "Visit"
SET "departedVia" = 'TYPED'
WHERE "departedVia" = 'WEB';

COMMIT;
