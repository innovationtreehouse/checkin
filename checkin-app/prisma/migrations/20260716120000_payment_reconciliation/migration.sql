-- Shopify payment reconciliation (lib/finance/reconcile.ts). Additive only:
-- new enums, a new PaymentException triage table, a reconciler high-water cursor
-- on BoardSettings, and a Shopify order-id on ProgramParticipant so a later
-- refund/chargeback/cancel can be joined back to an activated enrollment.

-- Enums
CREATE TYPE "PaymentExceptionKind" AS ENUM (
  'PAID_WHILE_BLOCKED',
  'NO_ITEM',
  'UNMATCHED_ORDER',
  'REFUND',
  'CHARGEBACK',
  'CANCELLED',
  'REVERSED_BEFORE_ACTIVATION',
  'AMOUNT_MISMATCH',
  'ACTIVE_WITHOUT_PAYMENT'
);
CREATE TYPE "PaymentExceptionSeverity" AS ENUM ('WARN', 'CRITICAL');
CREATE TYPE "PaymentExceptionStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- New nullable columns (additive, no backfill needed)
ALTER TABLE "BoardSettings" ADD COLUMN "shopifyReconcileCursorAt" TIMESTAMP(3);
ALTER TABLE "ProgramParticipant" ADD COLUMN "shopifyOrderId" TEXT;

-- Triage table
CREATE TABLE "PaymentException" (
  "id"             SERIAL NOT NULL,
  "kind"           "PaymentExceptionKind" NOT NULL,
  "severity"       "PaymentExceptionSeverity" NOT NULL DEFAULT 'WARN',
  "status"         "PaymentExceptionStatus" NOT NULL DEFAULT 'OPEN',
  "shopifyOrderId" TEXT,
  "processId"      INTEGER,
  "programId"      INTEGER,
  "personId"       INTEGER,
  "resolvedById"   INTEGER,
  "resolvedAt"     TIMESTAMP(3),
  "resolutionNote" TEXT,
  "detectedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentException_pkey" PRIMARY KEY ("id")
);

-- One row per (kind, order) so the hourly reconciler upserts instead of duplicating.
CREATE UNIQUE INDEX "PaymentException_kind_shopifyOrderId_key" ON "PaymentException"("kind", "shopifyOrderId");
CREATE INDEX "PaymentException_status_severity_idx" ON "PaymentException"("status", "severity");
