-- Ledger reconcile for environments that already applied the two migrations
-- this coalesce replaces (dev; prod applied NEITHER — v1.0.1 predates both, so
-- prod needs no reconcile and simply applies the coalesced migration at the
-- next release). Scoped to the replaced names — NOT a wholesale ledger wipe,
-- because the released 20260711 baseline row must survive.
BEGIN;
DELETE FROM "_prisma_migrations"
 WHERE migration_name IN
   ('20260715210000_org_membership_product_url',
    '20260716120000_payment_reconciliation');
INSERT INTO "_prisma_migrations"
    (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
VALUES
    (gen_random_uuid(), 'a3c95e6aff9c216910b957aab7c3fb03603b6a077e44c3aa5169890520f9ea25', '20260716150000_coalesced_post_v1_0_1', now(), now(), 1);
COMMIT;
