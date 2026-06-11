-- Push-based service freshness (review finding F7). Each watched service upserts its own
-- (service, env) row when a data run finishes, so the watchdog can READ freshness from this
-- dedicated monitoring DB instead of holding a credential to every service's financial
-- database. Success and failure are tracked in separate columns so the watchdog can still
-- detect "erroring" (a failure newer than the last success).
CREATE TABLE "service_heartbeat" (
    "service" TEXT NOT NULL,
    "env" TEXT NOT NULL,
    "last_success_at" TIMESTAMP(3),
    "last_failure_at" TIMESTAMP(3),
    "last_error" TEXT,
    "last_status" TEXT,
    "last_kind" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_heartbeat_pkey" PRIMARY KEY ("service", "env")
);
