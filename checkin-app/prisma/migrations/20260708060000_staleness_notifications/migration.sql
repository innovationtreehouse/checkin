-- Additive: a brand-new table, no existing row touched. Dedup ledger for the
-- household-direct staleness notifications (docs/designs/STALENESS_NOTIFICATIONS.md).
-- One row per (type, subjectKey, threshold) already-sent; the unique index makes
-- overlapping/retried daily cron runs idempotent (claim-then-send).
CREATE TABLE "NotificationLedger" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "threshold" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLedger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationLedger_type_subjectKey_threshold_key" ON "NotificationLedger"("type", "subjectKey", "threshold");
