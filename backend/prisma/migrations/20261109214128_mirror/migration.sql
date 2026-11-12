-- CreateEnum
CREATE TYPE "snapshot_source" AS ENUM ('sync', 'seed');

-- CreateEnum
CREATE TYPE "image_status" AS ENUM ('pending', 'stored', 'skipped', 'failed');

-- CreateEnum
CREATE TYPE "sync_status" AS ENUM ('running', 'ok', 'partial', 'failed');

-- CreateTable
CREATE TABLE "location" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_deprecated" BOOLEAN NOT NULL DEFAULT false,
    "raw" JSONB NOT NULL,
    "synced_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_tier" (
    "code" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "synced_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "price_tier_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "supplier" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT,
    "raw" JSONB NOT NULL,
    "cin7_modified_at" TIMESTAMPTZ(3),
    "synced_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT,
    "raw" JSONB NOT NULL,
    "cin7_modified_at" TIMESTAMPTZ(3),
    "synced_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product" (
    "id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "brand" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "uom" TEXT,
    "barcode" TEXT,
    "average_cost" DECIMAL(18,4) NOT NULL,
    "tier_prices" DECIMAL(18,4)[],
    "cin7_modified_at" TIMESTAMPTZ(3),
    "raw" JSONB NOT NULL,
    "synced_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_price_snapshot" (
    "id" BIGSERIAL NOT NULL,
    "product_id" UUID NOT NULL,
    "observed_at" TIMESTAMPTZ(3) NOT NULL,
    "average_cost" DECIMAL(18,4) NOT NULL,
    "tier_prices" DECIMAL(18,4)[],
    "source" "snapshot_source" NOT NULL,

    CONSTRAINT "product_price_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_image" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "download_url" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "status" "image_status" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "stored_at" TIMESTAMPTZ(3),

    CONSTRAINT "product_image_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase" (
    "id" UUID NOT NULL,
    "order_number" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "order_status" TEXT NOT NULL,
    "counted" BOOLEAN NOT NULL,
    "supplier_id" UUID,
    "supplier_name" TEXT NOT NULL,
    "order_date" DATE,
    "currency" TEXT NOT NULL,
    "base_currency" TEXT NOT NULL,
    "currency_rate" DECIMAL(18,6) NOT NULL,
    "total" DECIMAL(18,4) NOT NULL,
    "total_base" DECIMAL(18,4) NOT NULL,
    "receiving_status" TEXT,
    "invoice_status" TEXT,
    "cin7_updated_at" TIMESTAMPTZ(3) NOT NULL,
    "raw" JSONB NOT NULL,
    "synced_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_line" (
    "purchase_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "product_id" UUID,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit_price" DECIMAL(18,4) NOT NULL,
    "discount_pct" DECIMAL(5,2) NOT NULL,
    "unit_cost_base" DECIMAL(18,4) NOT NULL,
    "total_base" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "purchase_line_pkey" PRIMARY KEY ("purchase_id","line_no")
);

-- CreateTable
CREATE TABLE "sale" (
    "id" UUID NOT NULL,
    "order_number" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "order_status" TEXT NOT NULL,
    "counted" BOOLEAN NOT NULL,
    "customer_id" UUID,
    "customer_name" TEXT NOT NULL,
    "price_tier_name" TEXT,
    "order_date" DATE,
    "invoice_date" DATE,
    "currency" TEXT NOT NULL,
    "base_currency" TEXT NOT NULL,
    "currency_rate" DECIMAL(18,6) NOT NULL,
    "total" DECIMAL(18,4) NOT NULL,
    "total_base" DECIMAL(18,4) NOT NULL,
    "cogs_base" DECIMAL(18,4),
    "invoice_status" TEXT,
    "cin7_updated_at" TIMESTAMPTZ(3) NOT NULL,
    "raw" JSONB NOT NULL,
    "synced_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_line" (
    "sale_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "product_id" UUID,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit_price" DECIMAL(18,4) NOT NULL,
    "discount_pct" DECIMAL(5,2) NOT NULL,
    "unit_price_base" DECIMAL(18,4) NOT NULL,
    "average_cost" DECIMAL(18,4),
    "total_base" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "sale_line_pkey" PRIMARY KEY ("sale_id","line_no")
);

-- CreateTable
CREATE TABLE "stock_level" (
    "product_id" UUID NOT NULL,
    "location_name" TEXT NOT NULL,
    "bin" TEXT NOT NULL DEFAULT '',
    "batch" TEXT NOT NULL DEFAULT '',
    "on_hand" DECIMAL(18,4) NOT NULL,
    "allocated" DECIMAL(18,4) NOT NULL,
    "available" DECIMAL(18,4) NOT NULL,
    "on_order" DECIMAL(18,4) NOT NULL,
    "in_transit" DECIMAL(18,4) NOT NULL,
    "synced_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_level_pkey" PRIMARY KEY ("product_id","location_name","bin","batch")
);

-- CreateTable
CREATE TABLE "cin7_connection" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "account_id_enc" TEXT NOT NULL,
    "application_key_enc" TEXT NOT NULL,
    "verified_at" TIMESTAMPTZ(3),
    "webhook_path_token" TEXT,
    "webhook_bearer_enc" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cin7_connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_cursor" (
    "entity" TEXT NOT NULL,
    "last_success_at" TIMESTAMPTZ(3),
    "backfill_page" INTEGER NOT NULL DEFAULT 0,
    "backfill_done" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "sync_cursor_pkey" PRIMARY KEY ("entity")
);

-- CreateTable
CREATE TABLE "sync_run" (
    "id" BIGSERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" "sync_status" NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "finished_at" TIMESTAMPTZ(3),
    "api_calls" INTEGER NOT NULL DEFAULT 0,
    "counts" JSONB NOT NULL DEFAULT '{}',
    "errors" JSONB NOT NULL DEFAULT '[]',
    "error_code" TEXT,

    CONSTRAINT "sync_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_sku_idx" ON "product"("sku");

-- CreateIndex
CREATE INDEX "product_category_idx" ON "product"("category");

-- CreateIndex
CREATE INDEX "product_brand_idx" ON "product"("brand");

-- CreateIndex
CREATE INDEX "product_price_snapshot_product_id_observed_at_idx" ON "product_price_snapshot"("product_id", "observed_at");

-- CreateIndex
CREATE INDEX "product_image_product_id_idx" ON "product_image"("product_id");

-- CreateIndex
CREATE INDEX "purchase_order_date_idx" ON "purchase"("order_date");

-- CreateIndex
CREATE INDEX "purchase_supplier_id_idx" ON "purchase"("supplier_id");

-- CreateIndex
CREATE INDEX "purchase_line_product_id_idx" ON "purchase_line"("product_id");

-- CreateIndex
CREATE INDEX "sale_order_date_idx" ON "sale"("order_date");

-- CreateIndex
CREATE INDEX "sale_customer_id_idx" ON "sale"("customer_id");

-- CreateIndex
CREATE INDEX "sale_line_product_id_idx" ON "sale_line"("product_id");

-- CreateIndex
CREATE INDEX "sync_run_started_at_idx" ON "sync_run"("started_at");

-- AddForeignKey
ALTER TABLE "purchase_line" ADD CONSTRAINT "purchase_line_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_line" ADD CONSTRAINT "sale_line_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
