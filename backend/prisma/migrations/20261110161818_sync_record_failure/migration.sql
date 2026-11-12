-- CreateTable
CREATE TABLE "sync_record_failure" (
    "entity" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL,
    "last_code" TEXT NOT NULL,
    "last_message" TEXT NOT NULL,
    "first_failed_at" TIMESTAMPTZ(3) NOT NULL,
    "last_failed_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sync_record_failure_pkey" PRIMARY KEY ("entity","record_id")
);
