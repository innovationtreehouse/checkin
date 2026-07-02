-- Dev-instance sent-mail capture (EMAIL_DEV_MOCK.md). Lives only in checkin_dev / local;
-- never written in prod by construction (sendEmail's capture branch is guarded on
-- isDevInstance && NODE_ENV!=='production'). Retrievable at /dev/sent-mail so link/token
-- flows can be completed and verified without a RESEND_API_KEY.
CREATE TABLE "DevSentEmail" (
    "id" SERIAL NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DevSentEmail_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DevSentEmail_createdAt_idx" ON "DevSentEmail"("createdAt");
