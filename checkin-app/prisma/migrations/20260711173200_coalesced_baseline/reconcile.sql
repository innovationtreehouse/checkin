-- Ledger reconcile for the "20260711173200_coalesced_baseline" coalesce baseline.
--
-- Run ONCE against every already-migrated environment (dev, prod) so
-- Prisma's ledger (_prisma_migrations) shows exactly this baseline as
-- applied, instead of `prisma migrate deploy` trying (and failing) to
-- replay the squashed history this migration replaced.
--
-- See checkin-app/docs/MIGRATION_COALESCE_FLOW.md for the ECS one-off
-- command to run this against dev/prod. Safe to re-run (idempotent DELETE).
BEGIN;
DELETE FROM "_prisma_migrations";
INSERT INTO "_prisma_migrations"
    (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
VALUES
    (gen_random_uuid(), '30f4c571b4f607117bb57ad27e3071c1347a0451ddfd29bff874918fff763e52', '20260711173200_coalesced_baseline', now(), now(), 1);
COMMIT;
