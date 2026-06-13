-- CreateTable
CREATE TABLE "DevLedger" (
    "id" SERIAL NOT NULL,
    "action" TEXT NOT NULL,
    "realActor" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DevLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DevLedger_createdAt_idx" ON "DevLedger"("createdAt");
