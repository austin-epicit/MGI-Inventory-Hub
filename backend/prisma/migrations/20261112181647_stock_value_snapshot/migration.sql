-- CreateTable
CREATE TABLE "stock_value_snapshot" (
    "day" DATE NOT NULL,
    "value" DECIMAL(18,4) NOT NULL,
    "units" DECIMAL(18,4) NOT NULL,
    "source" "snapshot_source" NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_value_snapshot_pkey" PRIMARY KEY ("day")
);
