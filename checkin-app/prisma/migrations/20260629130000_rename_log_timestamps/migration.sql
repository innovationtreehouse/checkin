-- Normalize log timestamp columns to `timestamp`. Data-preserving: columns and
-- indexes are renamed in place (no DROP/CREATE), so existing rows survive.

-- RawBadgeLog.time -> timestamp
ALTER TABLE "RawBadgeLog" RENAME COLUMN "time" TO "timestamp";
ALTER INDEX "RawBadgeLog_participantId_time_idx" RENAME TO "RawBadgeLog_participantId_timestamp_idx";

-- AuditLog.time -> timestamp
ALTER TABLE "AuditLog" RENAME COLUMN "time" TO "timestamp";

-- ErrorLog.createdAt -> timestamp
ALTER TABLE "ErrorLog" RENAME COLUMN "createdAt" TO "timestamp";

-- IntegrationErrorLog.createdAt -> timestamp (resolvedAt left as-is: state change, not log time)
ALTER TABLE "IntegrationErrorLog" RENAME COLUMN "createdAt" TO "timestamp";
ALTER INDEX "IntegrationErrorLog_resolvedAt_createdAt_idx" RENAME TO "IntegrationErrorLog_resolvedAt_timestamp_idx";
