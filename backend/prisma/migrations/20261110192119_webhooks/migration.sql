-- CreateTable
CREATE TABLE "webhook_event" (
    "id" BIGSERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "record_ids" TEXT[],
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,

    CONSTRAINT "webhook_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "webhook_event_received_at_idx" ON "webhook_event"("received_at");
