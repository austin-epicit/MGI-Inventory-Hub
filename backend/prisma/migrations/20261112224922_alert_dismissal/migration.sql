-- CreateTable
CREATE TABLE "alert_dismissal" (
    "user_id" UUID NOT NULL,
    "alert_key" TEXT NOT NULL,
    "dismissed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_dismissal_pkey" PRIMARY KEY ("user_id","alert_key")
);

-- AddForeignKey
ALTER TABLE "alert_dismissal" ADD CONSTRAINT "alert_dismissal_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
