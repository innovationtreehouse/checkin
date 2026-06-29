-- Rename event-log models to the `*Log` convention. Data-preserving: tables,
-- constraints and indexes are renamed in place (no DROP/CREATE), so existing rows survive.
-- RawBadgeEvent -> RawBadgeLog also de-conflicts from the unrelated Event program model.

-- RawBadgeEvent -> RawBadgeLog
ALTER TABLE "RawBadgeEvent" RENAME TO "RawBadgeLog";
ALTER TABLE "RawBadgeLog" RENAME CONSTRAINT "RawBadgeEvent_pkey" TO "RawBadgeLog_pkey";
ALTER TABLE "RawBadgeLog" RENAME CONSTRAINT "RawBadgeEvent_participantId_fkey" TO "RawBadgeLog_participantId_fkey";
ALTER INDEX "RawBadgeEvent_participantId_time_idx" RENAME TO "RawBadgeLog_participantId_time_idx";

-- SystemMetric -> SystemMetricLog
ALTER TABLE "SystemMetric" RENAME TO "SystemMetricLog";
ALTER TABLE "SystemMetricLog" RENAME CONSTRAINT "SystemMetric_pkey" TO "SystemMetricLog_pkey";

-- IntegrationError -> IntegrationErrorLog
ALTER TABLE "IntegrationError" RENAME TO "IntegrationErrorLog";
ALTER TABLE "IntegrationErrorLog" RENAME CONSTRAINT "IntegrationError_pkey" TO "IntegrationErrorLog_pkey";
ALTER INDEX "IntegrationError_resolvedAt_createdAt_idx" RENAME TO "IntegrationErrorLog_resolvedAt_createdAt_idx";
