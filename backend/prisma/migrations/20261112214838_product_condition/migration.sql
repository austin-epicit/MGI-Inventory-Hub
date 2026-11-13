-- CreateEnum
CREATE TYPE "condition_grade" AS ENUM ('A', 'B', 'C', 'open_box', 'for_parts');

-- CreateTable
CREATE TABLE "product_condition" (
    "product_id" UUID NOT NULL,
    "grade" "condition_grade",
    "notes" TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "product_condition_pkey" PRIMARY KEY ("product_id")
);

-- CreateIndex
CREATE INDEX "product_condition_grade_idx" ON "product_condition"("grade");

-- AddForeignKey
ALTER TABLE "product_condition" ADD CONSTRAINT "product_condition_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_condition" ADD CONSTRAINT "product_condition_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
