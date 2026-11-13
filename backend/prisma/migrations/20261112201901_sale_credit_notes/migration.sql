-- CreateTable
CREATE TABLE "sale_credit_note" (
    "id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "number" TEXT,
    "credit_date" DATE,
    "status" TEXT NOT NULL,
    "counted" BOOLEAN NOT NULL,
    "currency_rate" DECIMAL(18,6) NOT NULL,
    "total_base" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "sale_credit_note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_credit_line" (
    "credit_note_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "product_id" UUID,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit_price_base" DECIMAL(18,4) NOT NULL,
    "total_base" DECIMAL(18,4) NOT NULL,
    "average_cost" DECIMAL(18,4),

    CONSTRAINT "sale_credit_line_pkey" PRIMARY KEY ("credit_note_id","line_no")
);

-- CreateIndex
CREATE INDEX "sale_credit_note_sale_id_idx" ON "sale_credit_note"("sale_id");

-- CreateIndex
CREATE INDEX "sale_credit_note_credit_date_idx" ON "sale_credit_note"("credit_date");

-- CreateIndex
CREATE INDEX "sale_credit_line_product_id_idx" ON "sale_credit_line"("product_id");

-- AddForeignKey
ALTER TABLE "sale_credit_line" ADD CONSTRAINT "sale_credit_line_credit_note_id_fkey" FOREIGN KEY ("credit_note_id") REFERENCES "sale_credit_note"("id") ON DELETE CASCADE ON UPDATE CASCADE;
