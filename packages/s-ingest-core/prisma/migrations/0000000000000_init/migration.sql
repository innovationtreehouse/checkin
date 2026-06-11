-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ObjectType" AS ENUM ('ORDER', 'PAYOUT', 'BALANCE_TXN', 'REFUND');

-- CreateEnum
CREATE TYPE "EventSource" AS ENUM ('BACKFILL', 'INCREMENTAL', 'HAND_LOADED', 'TEST_LOADED');

-- CreateEnum
CREATE TYPE "SyncKind" AS ENUM ('BACKFILL', 'INCREMENTAL');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "shopify_raw_event" (
    "id" BIGSERIAL NOT NULL,
    "store_id" TEXT NOT NULL,
    "object_type" "ObjectType" NOT NULL,
    "shopify_gid" TEXT NOT NULL,
    "shopify_legacy_id" TEXT,
    "occurred_at" TIMESTAMP(3),
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "EventSource" NOT NULL,
    "sync_run_id" BIGINT,
    "payload" JSONB NOT NULL,
    "payload_hash" TEXT NOT NULL,

    CONSTRAINT "shopify_raw_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_run" (
    "id" BIGSERIAL NOT NULL,
    "store_id" TEXT NOT NULL,
    "kind" "SyncKind" NOT NULL,
    "object_scope" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "status" "SyncStatus" NOT NULL DEFAULT 'RUNNING',
    "cursor_before" TEXT,
    "cursor_after" TEXT,
    "counts" JSONB,
    "error" TEXT,

    CONSTRAINT "sync_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_state" (
    "store_id" TEXT NOT NULL,
    "object_type" "ObjectType" NOT NULL,
    "last_updated_at_processed" TIMESTAMP(3),
    "bulk_operation_id" TEXT,
    "bulk_status" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_state_pkey" PRIMARY KEY ("store_id","object_type")
);

-- CreateTable
CREATE TABLE "shop_order" (
    "shopify_gid" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "legacy_id" TEXT,
    "name" TEXT,
    "customer_email" TEXT,
    "customer_name" TEXT,
    "financial_status" TEXT,
    "fulfillment_status" TEXT,
    "created_at" TIMESTAMP(3),
    "processed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "currency" TEXT,
    "subtotal_cents" INTEGER NOT NULL DEFAULT 0,
    "shipping_cents" INTEGER NOT NULL DEFAULT 0,
    "tax_cents" INTEGER NOT NULL DEFAULT 0,
    "discount_cents" INTEGER NOT NULL DEFAULT 0,
    "total_cents" INTEGER NOT NULL DEFAULT 0,
    "total_refunded_cents" INTEGER NOT NULL DEFAULT 0,
    "test" BOOLEAN NOT NULL DEFAULT false,
    "last_synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shop_order_pkey" PRIMARY KEY ("store_id","shopify_gid")
);

-- CreateTable
CREATE TABLE "shop_order_line" (
    "line_gid" TEXT NOT NULL,
    "order_gid" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "sku" TEXT,
    "title" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "price_cents" INTEGER NOT NULL DEFAULT 0,
    "discount_cents" INTEGER NOT NULL DEFAULT 0,
    "fulfillment_status" TEXT,
    "removed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "shop_order_line_pkey" PRIMARY KEY ("store_id","line_gid")
);

-- CreateTable
CREATE TABLE "shop_refund" (
    "refund_gid" TEXT NOT NULL,
    "order_gid" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3),
    "total_refunded_cents" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "shop_refund_pkey" PRIMARY KEY ("store_id","refund_gid")
);

-- CreateTable
CREATE TABLE "shop_payout" (
    "payout_gid" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "legacy_id" TEXT,
    "issued_at" TIMESTAMP(3),
    "status" TEXT,
    "currency" TEXT,
    "net_cents" INTEGER NOT NULL DEFAULT 0,
    "charges_gross_cents" INTEGER NOT NULL DEFAULT 0,
    "charges_fee_cents" INTEGER NOT NULL DEFAULT 0,
    "refunds_gross_cents" INTEGER NOT NULL DEFAULT 0,
    "refunds_fee_cents" INTEGER NOT NULL DEFAULT 0,
    "adjustments_gross_cents" INTEGER NOT NULL DEFAULT 0,
    "adjustments_fee_cents" INTEGER NOT NULL DEFAULT 0,
    "reserved_funds_cents" INTEGER NOT NULL DEFAULT 0,
    "retried_cents" INTEGER NOT NULL DEFAULT 0,
    "last_synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shop_payout_pkey" PRIMARY KEY ("store_id","payout_gid")
);

-- CreateTable
CREATE TABLE "shop_balance_transaction" (
    "txn_gid" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "payout_gid" TEXT,
    "order_gid" TEXT,
    "type" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "fee_cents" INTEGER NOT NULL,
    "net_cents" INTEGER NOT NULL,
    "currency" TEXT,
    "transaction_date" TIMESTAMP(3),
    "source_order_transaction_id" TEXT,

    CONSTRAINT "shop_balance_transaction_pkey" PRIMARY KEY ("store_id","txn_gid")
);

-- CreateIndex
CREATE INDEX "shopify_raw_event_object_type_shopify_gid_idx" ON "shopify_raw_event"("object_type", "shopify_gid");

-- CreateIndex
CREATE INDEX "shopify_raw_event_sync_run_id_idx" ON "shopify_raw_event"("sync_run_id");

-- CreateIndex
CREATE INDEX "shopify_raw_event_store_id_object_type_occurred_at_idx" ON "shopify_raw_event"("store_id", "object_type", "occurred_at");

-- CreateIndex
CREATE INDEX "sync_run_store_id_kind_started_at_idx" ON "sync_run"("store_id", "kind", "started_at");

-- CreateIndex
CREATE INDEX "shop_order_store_id_legacy_id_idx" ON "shop_order"("store_id", "legacy_id");

-- CreateIndex
CREATE INDEX "shop_order_store_id_name_idx" ON "shop_order"("store_id", "name");

-- CreateIndex
CREATE INDEX "shop_order_line_store_id_order_gid_idx" ON "shop_order_line"("store_id", "order_gid");

-- CreateIndex
CREATE INDEX "shop_refund_store_id_order_gid_idx" ON "shop_refund"("store_id", "order_gid");

-- CreateIndex
CREATE INDEX "shop_payout_store_id_legacy_id_idx" ON "shop_payout"("store_id", "legacy_id");

-- CreateIndex
CREATE INDEX "shop_payout_store_id_issued_at_idx" ON "shop_payout"("store_id", "issued_at");

-- CreateIndex
CREATE INDEX "shop_balance_transaction_store_id_payout_gid_idx" ON "shop_balance_transaction"("store_id", "payout_gid");

-- CreateIndex
CREATE INDEX "shop_balance_transaction_store_id_order_gid_idx" ON "shop_balance_transaction"("store_id", "order_gid");

