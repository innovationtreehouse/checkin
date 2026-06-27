-- CreateTable
CREATE TABLE "store" (
    "myshopify_domain" TEXT NOT NULL,
    "shop_gid" TEXT NOT NULL,
    "numeric_id" TEXT NOT NULL,
    "name" TEXT,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_pkey" PRIMARY KEY ("myshopify_domain")
);

-- CreateIndex
CREATE UNIQUE INDEX "store_shop_gid_key" ON "store"("shop_gid");

