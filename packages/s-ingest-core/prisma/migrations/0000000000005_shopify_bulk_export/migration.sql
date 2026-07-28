-- Durable, append-only capture of the verbatim Bulk Operation JSONL, stored BEFORE
-- reassembly so backfilled orders can be re-derived without re-pulling from Shopify.
CREATE TABLE "shopify_bulk_export" (
    "id" BIGSERIAL NOT NULL,
    "store_id" TEXT NOT NULL,
    "object_type" "ObjectType" NOT NULL,
    "bulk_operation_id" TEXT NOT NULL,
    "source" "EventSource" NOT NULL,
    "sync_run_id" BIGINT,
    "record_count" INTEGER NOT NULL,
    "jsonl" TEXT NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shopify_bulk_export_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shopify_bulk_export_store_id_object_type_fetched_at_idx" ON "shopify_bulk_export"("store_id", "object_type", "fetched_at");
