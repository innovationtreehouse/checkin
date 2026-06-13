-- Dead-letter state for the relay outbox. A delivery that fails permanently (malformed
-- SNS attribute, AuthorizationError, deleted topic) or exhausts RELAY_MAX_ATTEMPTS is
-- moved to DEAD instead of being retried forever — so a single poison row can no longer
-- wedge the oldest-first drain. `dead_at` records when it was parked. The relay reports
-- itself unhealthy (serviceError metric) for as long as any DEAD rows exist.
ALTER TYPE "outbox_status" ADD VALUE 'DEAD';

ALTER TABLE "monitoring_outbox" ADD COLUMN "dead_at" TIMESTAMP(3);
